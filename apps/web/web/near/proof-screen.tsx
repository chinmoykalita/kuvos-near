import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { useCareSession } from '@kuvos/mobile-core/care-session';
import { Button } from '@kuvos/mobile-core/components/button';
import { Screen } from '@kuvos/mobile-core/components/screen';
import { Text } from '@kuvos/mobile-core/components/text';
import { colors } from '@kuvos/mobile-core/theme';

import { useNear } from './extensions';
import { kindLabel, nearApi, type Attestation, type Check, type ProofBundle } from './near-api';
import { StateChip } from './proofs-screen';
import { signCommitment } from './wallet';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});
const short = (value: string, size = 14) => (value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-6)}` : value);

export function downloadBundle(bundle: ProofBundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kuvos-proof-${bundle.event.id}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="gap-0.5">
      <Text className="text-2xs uppercase tracking-eyebrow text-slate">{label}</Text>
      <Text selectable className={`text-sm text-ink ${mono ? 'font-mono' : ''}`}>
        {value}
      </Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-3xl border border-line bg-white p-5">
      <Text className="text-base font-bold text-deep-blue">{title}</Text>
      {children}
    </View>
  );
}

export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <View className="gap-2">
      {checks.map((check, index) => (
        <View key={`${check.name}-${index}`} className="flex-row gap-3">
          <Text className={`w-12 text-xs font-bold ${check.ok === true ? 'text-fresh-green' : check.ok === false ? 'text-coral' : 'text-slate'}`}>
            {check.ok === true ? 'PASS' : check.ok === false ? 'FAIL' : 'SKIP'}
          </Text>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-ink">{check.name}</Text>
            <Text className="text-xs leading-4 text-slate">{check.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function AttestationRow({ attestation }: { attestation: Attestation }) {
  return (
    <View className="gap-1 rounded-2xl bg-ice p-3">
      <Text className="text-sm font-semibold text-ink">
        {attestation.model} · {attestation.purpose}
      </Text>
      <Text className="text-xs text-slate">
        {attestation.signatureKind === 'provider_tee' ? 'Signed inside the model TEE' : attestation.signatureKind} · TCB{' '}
        {attestation.tcbStatus ?? 'unknown'} · {attestation.e2ee ? 'end-to-end encrypted' : 'TLS to attested gateway'}
      </Text>
      <Text selectable className="font-mono text-xs text-slate">
        signer {short(attestation.signingAddress)}
      </Text>
    </View>
  );
}

function Details({ bundle }: { bundle: ProofBundle }) {
  const payload = object(JSON.parse(bundle.event.payload));
  const body = object(payload.body);
  if (bundle.event.kind === 'plan_version') {
    const plan = object(body.plan);
    const items = Array.isArray(body.items) ? (body.items as Json[]) : [];
    return (
      <Card title={`${String(plan.name)} · version ${String(body.planVersion)}`}>
        <Text className="text-sm text-slate">
          {String(body.reason) === 'closed' ? 'Plan closed.' : 'Every item below was reviewed against its source and confirmed by a person.'}
        </Text>
        {items.map((item) => (
          <View key={String(item.id)} className="gap-0.5 border-t border-line pt-2">
            <Text className="text-sm font-semibold text-ink">{String(item.actionText ?? item.instructionText)}</Text>
            <Text className="text-xs text-slate">
              Source evidence {(item.evidenceSpanIds as string[] | undefined)?.join(', ') || 'library item'} · candidate {String(item.candidateId)}
            </Text>
          </View>
        ))}
      </Card>
    );
  }
  if (bundle.event.kind === 'activity') {
    return (
      <Card title={`Marked ${String(body.action)}`}>
        {!!body.reason && <Row label="Reason" value={String(body.reason)} />}
        <Row label="Scheduled" value={new Date(String(body.scheduledAt)).toLocaleString()} />
        <Row label="Recorded" value={new Date(String(body.recordedAt)).toLocaleString()} />
        {!!object(body.planVersion).digest && <Row label="Against plan version" value={short(String(object(body.planVersion).digest))} mono />}
        <Text className="text-xs leading-4 text-slate">
          This proves who recorded the statement and that it has not changed since. It does not prove a medicine was taken.
        </Text>
      </Card>
    );
  }
  const policy = object(body.policy);
  return (
    <Card title={`Tomo ${String(body.decision)}`}>
      <Row label="Route" value={String(body.rule)} />
      <Row label="Rules" value={`${String(policy.name)} v${String(policy.version)} · ${short(String(policy.hash))}`} mono />
      <Row label="Model called" value={body.modelCalled ? 'Yes, NEAR AI Cloud TEE' : 'No, fixed reply'} />
      <Text className="text-xs leading-4 text-slate">Only salted hashes of the question and reply are committed, never the words.</Text>
    </Card>
  );
}

export function NearProofScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useCareSession();
  const { wallet, config } = useNear();
  const [bundle, setBundle] = useState<ProofBundle>();
  const [checks, setChecks] = useState<Check[]>();
  const [busy, setBusy] = useState<'' | 'sign' | 'verify'>('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    nearApi
      .event(id)
      .then((next) => active && setBundle(next))
      .catch((caught: unknown) => active && setError(caught instanceof Error ? caught.message : 'Could not load this proof.'));
    return () => {
      active = false;
    };
  }, [id]);

  async function sign() {
    if (!bundle) return;
    setBusy('sign');
    setError('');
    try {
      setBundle(await signCommitment(config?.network ?? 'testnet', bundle));
      setChecks(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Signing failed.');
    } finally {
      setBusy('');
    }
  }

  async function verify() {
    if (!bundle) return;
    setBusy('verify');
    try {
      setChecks((await nearApi.verify(bundle)).checks);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification failed.');
    } finally {
      setBusy('');
    }
  }

  if (!bundle)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Proof' }} />
        {error ? <Text className="text-coral">{error}</Text> : <ActivityIndicator color={colors.cobalt} />}
      </Screen>
    );

  const canSign = bundle.event.kind !== 'gate_decision' && !bundle.signature && bundle.event.actorId === me.user.id;

  return (
    <Screen>
      <Stack.Screen options={{ title: kindLabel[bundle.event.kind] }} />
      <View className="flex-row items-center justify-between">
        <Text className="text-2xs uppercase tracking-eyebrow text-cobalt">{kindLabel[bundle.event.kind]}</Text>
        <StateChip state={bundle.event.state} signed={!!bundle.signature} />
      </View>
      <Details bundle={bundle} />

      {bundle.attestations.length > 0 && (
        <Card title="Private AI (NEAR AI Cloud TEE)">
          <Text className="text-sm text-slate">
            Each model reply below was signed by a key that Intel TDX and NVIDIA attestation bind to the enclave, over the
            exact request and response bytes.
          </Text>
          {bundle.attestations.map((attestation, index) => (
            <AttestationRow key={`${attestation.signature}-${index}`} attestation={attestation} />
          ))}
        </Card>
      )}

      <Card title="Human signature">
        {bundle.signature ? (
          <>
            <Row label="Signed by" value={bundle.signature.accountId} />
            <Row label="Key" value={short(bundle.signature.publicKey, 18)} mono />
          </>
        ) : bundle.event.kind === 'gate_decision' ? (
          <Text className="text-sm text-slate">Tomo decisions are system records and are not signed by people.</Text>
        ) : (
          <Text className="text-sm text-slate">Not signed yet. Signing is optional and never blocks care.</Text>
        )}
        {canSign &&
          (wallet?.accountId ? (
            <Button title={`Sign as ${wallet.accountId}`} loading={busy === 'sign'} onPress={() => void sign()} />
          ) : (
            <Text className="text-sm text-slate">Link a NEAR account on the previous screen to sign.</Text>
          ))}
      </Card>

      <Card title="Anchored on NEAR">
        <Row label="Commitment (SHA-256)" value={bundle.event.digest} mono />
        {bundle.anchor ? (
          <>
            <Row label="Merkle root" value={bundle.anchor.root} mono />
            <Row label="Contract" value={`${bundle.anchor.contractId} · ${bundle.anchor.network}`} />
            <Row label="Batch" value={`${bundle.anchor.batchId} · leaf ${bundle.anchor.leafIndex} · ${bundle.anchor.status.toLowerCase()}`} />
            {bundle.anchor.transactionUrl && (
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(bundle.anchor!.transactionUrl!)}>
                <Text className="text-sm font-semibold text-cobalt underline">View transaction {short(bundle.anchor.transaction!, 10)}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Text className="text-sm text-slate">Waiting for the next batch. Roots are anchored about every 30 seconds.</Text>
        )}
      </Card>

      <View className="flex-row gap-3">
        <Button title="Verify now" className="flex-1" loading={busy === 'verify'} onPress={() => void verify()} />
        <Button title="Download proof" variant="secondary" className="flex-1" onPress={() => downloadBundle(bundle)} />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" className="text-sm text-coral">
          {error}
        </Text>
      )}
      {checks && (
        <Card title="Independent checks">
          <CheckList checks={checks} />
          <Text className="text-xs leading-4 text-slate">
            Anyone can rerun these with the downloaded file: open /verify in this app, or run `pnpm verify bundle.json`.
          </Text>
        </Card>
      )}
    </Screen>
  );
}
