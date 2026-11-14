import { wordmark } from '../config';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { api, updateAiProcessingConsent, uploadDocument, type Me, type UploadAsset } from '../api';
import { Button } from '../components/button';
import { CheckList, FlowHero, FlowScreen } from '../components/flow';
import { Sheet } from '../components/sheet';
import { Text } from '../components/text';
import { onboardingSteps } from '../onboarding-draft';
import { scanPagesHtml } from '../scan-pages';
import { colors } from '../theme';

const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff'];
const isStandaloneDocument = (asset: UploadAsset) =>
  /\.(pdf|tiff?)$/i.test(asset.name) || asset.mimeType === 'application/pdf' || asset.mimeType === 'image/tiff';

function imageAsset(selected: ImagePicker.ImagePickerAsset): UploadAsset {
  const mimeType = selected.mimeType || 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  return {
    uri: selected.uri,
    name: `${selected.fileName?.replace(/\.[^.]+$/, '') || `care-document-${Date.now()}`}.${extension}`,
    mimeType,
  };
}

export function UploadScreen({ patientId, planId }: { patientId: string; planId?: string }) {
  const router = useRouter();
  const [assets, setAssets] = useState<UploadAsset[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [me, setMe] = useState<Me>();
  const [consented, setConsented] = useState<boolean>();
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasStandaloneDocument = assets.some(isStandaloneDocument);

  useEffect(() => {
    let active = true;
    api<Me>('/me')
      .then((next) => {
        if (!active) return;
        setMe(next);
        setConsented(next.user.aiProcessingConsent);
      })
      .catch(
        (caught) =>
          active && setError(caught instanceof Error ? caught.message : 'Could not check AI processing consent.'),
      );
    return () => {
      active = false;
    };
  }, []);

  async function acceptConsent() {
    setConsentBusy(true);
    setError('');
    try {
      await updateAiProcessingConsent(true);
      setConsented(true);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save AI processing consent.');
      return false;
    } finally {
      setConsentBusy(false);
    }
  }

  async function chooseDocument() {
    setError('');
    const result = await DocumentPicker.getDocumentAsync({
      type: acceptedTypes,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      const selected = result.assets[0];
      const asset = {
        uri: selected.uri,
        name: selected.name,
        mimeType: selected.mimeType || 'application/octet-stream',
      };
      if (isStandaloneDocument(asset)) {
        if (assets.length) {
          Alert.alert('Replace selected pages?', 'A PDF or TIFF must be uploaded on its own.', [
            { text: 'Keep pages', style: 'cancel' },
            {
              text: 'Replace',
              onPress: () => {
                setAssets([asset]);
                setPreviewIndex(0);
              },
            },
          ]);
        } else {
          setAssets([asset]);
          setPreviewIndex(0);
        }
      } else if (hasStandaloneDocument) {
        setError('Remove the PDF or TIFF before adding photos.');
      } else if (asset.mimeType !== 'image/jpeg' && asset.mimeType !== 'image/png') {
        setError('Please choose a PDF, TIFF, JPG or PNG file.');
      } else {
        setAssets((previous) => [...previous, asset]);
        setPreviewIndex(assets.length);
      }
    }
  }

  async function takePhoto() {
    setError('');
    if (hasStandaloneDocument) {
      setError('Remove the PDF or TIFF before adding photos.');
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is needed to photograph a care document.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!result.canceled) {
      const asset = imageAsset(result.assets[0]);
      if (asset.mimeType !== 'image/jpeg' && asset.mimeType !== 'image/png') {
        setError('Please capture a JPG or PNG photo.');
        return;
      }
      setAssets((previous) => [...previous, asset]);
      setPreviewIndex(assets.length);
    }
  }

  async function choosePhoto() {
    setError('');
    if (hasStandaloneDocument) {
      setError('Remove the PDF or TIFF before adding photos.');
      return;
    }
    if (Platform.OS !== 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo access is needed to choose a care document.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      quality: 0.9,
    });
    if (!result.canceled) {
      const selected = result.assets.map(imageAsset);
      if (selected.some((asset) => asset.mimeType !== 'image/jpeg' && asset.mimeType !== 'image/png')) {
        setError('Please choose JPG or PNG photos.');
        return;
      }
      setAssets((previous) => [...previous, ...selected]);
      setPreviewIndex(assets.length);
    }
  }

  async function submit(consentGiven = consented === true) {
    if (!assets.length || !consentGiven || busy) return;
    setBusy(true);
    setError('');
    try {
      if (assets.reduce((total, asset) => total + new File(asset.uri).size, 0) > 50_000_000) {
        throw new Error('These pages exceed the 50 MB upload limit. Remove some pages and try again.');
      }
      let upload = assets[0];
      if (assets.length > 1) {
        // ponytail: build the PDF in memory; move assembly off-device if 50 MB scans become common.
        const images = [];
        for (const asset of assets) {
          images.push({
            mimeType: asset.mimeType,
            base64: await new File(asset.uri).base64(),
          });
        }
        const pdf = await Print.printToFileAsync({
          html: scanPagesHtml(images),
          width: 612,
          height: 792,
        });
        if (pdf.numberOfPages !== assets.length) {
          throw new Error('Could not prepare every scanned page. Please try again.');
        }
        upload = {
          uri: pdf.uri,
          name: 'scanned-care-document.pdf',
          mimeType: 'application/pdf',
        };
      }
      if (new File(upload.uri).size > 50_000_000) {
        throw new Error('These pages exceed the 50 MB upload limit. Remove some pages and try again.');
      }
      const created = await uploadDocument(patientId, upload, planId);
      router.push({
        pathname: '/extraction/[id]',
        params: {
          id: created.extractionId,
          patientId,
          ...(hasStandaloneDocument ? {} : { pages: String(assets.length) }),
          ...(planId ? { planId } : {}),
        },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The document could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  const membership = me?.memberships.find((item) => item.patient.id === patientId);
  const caregiver = membership?.role === 'CAREGIVER';
  const patientFirstName = membership?.patient.name.trim().split(/\s+/)[0] ?? '';
  const initial = (caregiver ? membership?.patient.name : me?.user.name)?.trim().slice(0, 1).toUpperCase();
  const pageLabel = hasStandaloneDocument
    ? 'this document'
    : `${assets.length} ${assets.length === 1 ? 'page' : 'pages'}`;

  function startReading() {
    if (consented === true) void submit();
    else setConsentOpen(true);
  }

  const sources = [
    { title: 'Take a photo', detail: 'One page at a time. Best for paper.', icon: 'camera', onPress: takePhoto },
    { title: 'Choose from photos', detail: 'Pick one or more pictures.', icon: 'image', onPress: choosePhoto },
    { title: 'Choose a PDF', detail: 'From the hospital or clinic.', icon: 'file', onPress: chooseDocument },
  ] as const;

  return (
    <FlowScreen
      step={3}
      steps={onboardingSteps}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      footer={
        assets.length ? (
          <>
            <Button
              disabled={consented === undefined}
              loading={busy}
              title={busy && assets.length > 1 ? 'Preparing pages…' : `Read ${pageLabel}`}
              onPress={startReading}
            />
            <Text className="text-center text-sm text-slate">PDF, JPG, PNG or TIFF · up to 50 MB</Text>
          </>
        ) : (
          <>
            {caregiver && membership?.canInviteRole === 'PATIENT' && (
              <Pressable
                accessibilityRole="button"
                className="min-h-11 items-center justify-center"
                onPress={() =>
                  router.push({ pathname: '/invite', params: { patientId, role: 'PATIENT' } })
                }
              >
                <Text className="text-base font-bold text-cobalt">
                  Invite {patientFirstName || 'them'} to add it instead
                </Text>
              </Pressable>
            )}
            <Text className="pb-1 text-center text-sm text-slate">{wordmark} does not give medical advice.</Text>
          </>
        )
      }
    >
      <FlowHero
        initial={initial ?? ''}
        eyebrow={planId ? 'Plan · Add a document' : `Plan · Step 3 of ${onboardingSteps}`}
        title={caregiver && patientFirstName ? `Add ${patientFirstName}’s ` : 'Add your '}
        accent="prescription"
        subtitle={caregiver ? 'A photo or PDF from their doctor.' : 'A photo or PDF from your doctor.'}
      />

      <View className="rounded-3xl border border-line bg-white px-4">
        {sources.map((source, index) => (
          <Pressable
            key={source.title}
            accessibilityRole="button"
            className={`min-h-[72px] flex-row items-center gap-3 py-4 ${index ? 'border-t border-line' : ''}`}
            disabled={busy}
            onPress={() => void source.onPress()}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              className={`h-10 w-10 items-center justify-center rounded-full ${index === 0 ? 'bg-deep-blue' : 'bg-ice'}`}
            >
              <SourceIcon name={source.icon} color={index === 0 ? colors.white : colors.deepBlue} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-base font-bold text-ink">{source.title}</Text>
              <Text className="text-sm text-slate">{source.detail}</Text>
            </View>
            <Text className="text-xl text-slate">›</Text>
          </Pressable>
        ))}
      </View>

      {assets.length > 0 && (
        <View className="gap-3 rounded-3xl border border-line bg-white p-4">
          <Text className="text-sm font-bold text-ink">
            {hasStandaloneDocument ? 'Selected document' : `${pageLabel} ready`}
          </Text>
          {hasStandaloneDocument ? (
            <View className="flex-row items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-xl bg-ice">
                <SourceIcon name="file" color={colors.deepBlue} />
              </View>
              <Text selectable numberOfLines={1} className="min-w-0 flex-1 text-base text-ink">
                {assets[0].name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove document"
                className="min-h-11 justify-center px-1"
                disabled={busy}
                onPress={() => setAssets([])}
              >
                <Text className="text-sm font-semibold text-slate">Remove</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Image
                accessibilityLabel={`Preview of page ${Math.min(previewIndex, assets.length - 1) + 1}`}
                className="h-48 w-full rounded-2xl bg-cloud"
                contentFit="contain"
                source={{ uri: assets[Math.min(previewIndex, assets.length - 1)].uri }}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {assets.map((asset, index) => (
                  <View key={`${asset.uri}-${index}`}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Preview page ${index + 1}`}
                      className={`rounded-xl border-2 ${index === previewIndex ? 'border-deep-blue' : 'border-transparent'}`}
                      disabled={busy}
                      onPress={() => setPreviewIndex(index)}
                    >
                      <Image className="h-16 w-12 rounded-lg bg-cloud" contentFit="cover" source={{ uri: asset.uri }} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove page ${index + 1}`}
                      className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-deep-blue"
                      disabled={busy}
                      hitSlop={8}
                      onPress={() => {
                        setAssets((previous) => previous.filter((_, page) => page !== index));
                        setPreviewIndex((previous) => Math.max(0, previous > index ? previous - 1 : previous));
                      }}
                    >
                      <Text className="text-xs font-bold text-white">✕</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      )}

      <CheckList
        lines={['Every task links to the page it came from', 'Nothing starts until you confirm it']}
      />

      {!!error && (
        <Text selectable accessibilityRole="alert" className="rounded-2xl bg-coral/15 p-4 text-base text-ink">
          {error}
        </Text>
      )}

      <Sheet visible={consentOpen} closeLabel="Not now" onClose={() => setConsentOpen(false)}>
        <Text accessibilityRole="header" className="font-serif text-2xl text-ink">
          Before we <Text className="font-serif-italic text-cobalt">read it</Text>
        </Text>
        <CheckList
          lines={[
            'AI reads the page and suggests tasks.',
            'You check every one. Nothing starts on its own.',
            <Text key="privacy" className="text-sm text-slate">
              Used only to build this plan.{' '}
              <Text
                accessibilityRole="link"
                className="text-sm font-bold text-cobalt"
                onPress={() => void Linking.openURL('https://kuvosai.com/privacy').catch(() => undefined)}
              >
                Privacy
              </Text>
            </Text>,
          ]}
        />
        <View className="rounded-2xl bg-sun p-4">
          <Text className="text-sm text-ink">
            <Text className="text-sm font-bold text-ink">Beta:</Text> please use a sample prescription, not real
            patient details.
          </Text>
        </View>
        <Button
          loading={consentBusy}
          title="I agree, continue"
          onPress={() =>
            void acceptConsent().then((accepted) => {
              if (!accepted) return;
              setConsentOpen(false);
              void submit(true);
            })
          }
        />
        <Button title="Not now" variant="secondary" onPress={() => setConsentOpen(false)} />
      </Sheet>
    </FlowScreen>
  );
}

function SourceIcon({ name, color }: { name: 'camera' | 'image' | 'file'; color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {name === 'camera' ? (
        <>
          <Path d="M4 8h3l2-2.5h6L17 8h3v11H4Z" />
          <Circle cx={12} cy={13} r={3.5} />
        </>
      ) : name === 'image' ? (
        <>
          <Rect x={4} y={4} width={16} height={16} rx={3} />
          <Circle cx={9.5} cy={9.5} r={1.5} />
          <Path d="m20 15-4.5-4.5L6 20" />
        </>
      ) : (
        <>
          <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <Path d="M14 3v5h5M9 13h6M9 17h4" />
        </>
      )}
    </Svg>
  );
}
