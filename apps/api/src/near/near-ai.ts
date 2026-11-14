import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// NEAR AI Cloud private inference. The official SDK verifies the Gateway and model TDX
// attestations before a prompt is sent, then verifies the model TEE's signature over the
// exact request and response bytes. Kuvos accepts only `provider_tee` signatures: a Gateway
// signature does not prove the model ran inside a TEE.

export type AiAttestation = {
  provider: 'near-ai-cloud';
  purpose: string;
  model: string;
  completionId: string;
  signatureKind: 'provider_tee' | 'gateway';
  signedText: string;
  signature: string;
  signingAlgo: string;
  signingAddress: string;
  tcbStatus?: string;
  composeHash?: string;
  osImageHash?: string;
  gpuEvidence?: string;
  quoteNonce?: string;
  e2ee: boolean;
  verifiedAt: string;
};

type Signer = { signingAlgo: string; signingAddress: string };
type VerifiedModelAttestation = {
  tcbStatus?: string;
  gpuEvidence?: string;
  deployment?: {
    runtimeMeasurements?: { composeHash?: string; osImageHash?: string };
  };
  report?: { nonce?: string };
};
type Verified = {
  id: string;
  signatureKind: 'provider_tee' | 'gateway';
  signature: { signedText: string; signature: string; signer: Signer };
  attestations?: readonly VerifiedModelAttestation[];
};
export type ChatCompletion = {
  id: string;
  model?: string;
  choices: {
    finish_reason?: string | null;
    message: Record<string, unknown>;
  }[];
};
type Client = {
  chat: {
    completions: {
      create(body: Record<string, unknown>): Promise<ChatCompletion>;
    };
  };
  verifyResponse(id: string): Promise<Verified>;
};

let client: Promise<Client> | undefined;

export const nearAiConfigured = (config: ConfigService) =>
  !!config.get<string>('NEARAI_API_KEY');

function getClient(config: ConfigService): Promise<Client> {
  client ??= (async () => {
    const sdk = (await import('@nearai/inference-sdk/node')) as unknown as {
      InferenceClient: new (options: Record<string, unknown>) => Client;
    };
    return new sdk.InferenceClient({
      apiKey: config.getOrThrow<string>('NEARAI_API_KEY'),
      baseUrl:
        config.get<string>('NEARAI_BASE_URL') || 'https://cloud-api.near.ai/v1',
      e2ee: config.get('NEARAI_E2EE', 'true') === 'true',
      signingAlgo: 'ed25519',
    });
  })();
  client.catch(() => (client = undefined));
  return client;
}

export function attestationRecord(
  verified: Verified,
  model: string,
  purpose: string,
  e2ee: boolean,
): AiAttestation {
  const report = verified.attestations?.[0];
  return {
    provider: 'near-ai-cloud',
    purpose,
    model,
    completionId: verified.id,
    signatureKind: verified.signatureKind,
    signedText: verified.signature.signedText,
    signature: verified.signature.signature,
    signingAlgo: verified.signature.signer.signingAlgo,
    signingAddress: verified.signature.signer.signingAddress,
    tcbStatus: report?.tcbStatus,
    composeHash: report?.deployment?.runtimeMeasurements?.composeHash,
    osImageHash: report?.deployment?.runtimeMeasurements?.osImageHash,
    gpuEvidence: report?.gpuEvidence,
    // The Intel quote itself (~10 KB) is not stored per reply; the signer it binds is.
    quoteNonce: report?.report?.nonce,
    e2ee,
    verifiedAt: new Date().toISOString(),
  };
}

export type AttestedChat = (
  config: ConfigService,
  body: Record<string, unknown> & { model: string },
  purpose: string,
) => Promise<{ completion: ChatCompletion; attestation: AiAttestation }>;

// Checks replace `chat` with a synthetic transport; production always uses the SDK below.
export const nearAiTransport: { chat: AttestedChat } = {
  chat: (config, body, purpose) => sdkChat(config, body, purpose),
};

export const attestedChat: AttestedChat = (config, body, purpose) =>
  nearAiTransport.chat(config, body, purpose);

async function sdkChat(
  config: ConfigService,
  body: Record<string, unknown> & { model: string },
  purpose: string,
): Promise<{ completion: ChatCompletion; attestation: AiAttestation }> {
  const nearAi = await getClient(config);
  const completion = await nearAi.chat.completions.create(body);
  const verified = await nearAi.verifyResponse(completion.id);
  if (verified.signatureKind !== 'provider_tee')
    // Never show an answer whose model TEE execution was not proven.
    throw new ServiceUnavailableException(
      'The private AI model could not prove it ran in a TEE, so its reply was discarded.',
    );
  return {
    completion,
    attestation: attestationRecord(
      verified,
      body.model,
      purpose,
      config.get('NEARAI_E2EE', 'true') === 'true',
    ),
  };
}
