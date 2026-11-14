import type { NearConnector } from '@hot-labs/near-connect';

import { authClient } from '../core/auth-client';

import { nearApi, type ProofBundle } from './near-api';

// NEAR Connect runs each wallet's code in a sandboxed iframe (HOT, Meteor, MyNearWallet,
// Intear, near-cli and more). Kuvos only asks for NEP-413 message signatures: no transaction,
// no access key and no tokens are ever requested from the person's wallet.
let connector: Promise<NearConnector> | undefined;

function getConnector(network: string) {
  connector ??= import('@hot-labs/near-connect').then(
    ({ NearConnector }) =>
      new NearConnector({
        network: network === 'mainnet' ? 'mainnet' : 'testnet',
        features: { signMessage: true, ...(network === 'mainnet' ? {} : { testnet: true }) },
        footerBranding: null,
      }),
  );
  return connector;
}

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((byte) => parseInt(byte, 16)));

async function connectedWallet(network: string) {
  const near = await getConnector(network);
  try {
    const current = await near.getConnectedWallet();
    if (current.accounts.length) return { wallet: current.wallet, accountId: current.accounts[0].accountId };
  } catch {
    // Not connected yet.
  }
  const wallet = await near.connect();
  const accounts = await wallet.getAccounts();
  if (!accounts[0]) throw new Error('The wallet did not share a NEAR account.');
  return { wallet, accountId: accounts[0].accountId };
}

// Links the person's NEAR account with a one-use NEP-413 challenge checked by the API.
export async function linkNearAccount(network: string) {
  const { wallet, accountId } = await connectedWallet(network);
  const challenge = await nearApi.challenge(accountId);
  const signed = await wallet.signMessage({
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: hexBytes(challenge.nonce),
    network: network === 'mainnet' ? 'mainnet' : 'testnet',
  });
  if (!signed) throw new Error('Signing was cancelled.');
  return nearApi.connect({ accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature });
}

export async function unlinkNearAccount(network: string) {
  const near = await getConnector(network);
  await near.disconnect().catch(() => undefined);
  return nearApi.disconnect();
}

// The person endorses the exact salted digest; the nonce is derived from it on the server.
export async function signCommitment(network: string, bundle: ProofBundle) {
  const { wallet } = await connectedWallet(network);
  const signed = await wallet.signMessage({
    message: bundle.signing.message,
    recipient: bundle.signing.recipient,
    nonce: hexBytes(bundle.signing.nonce),
    network: network === 'mainnet' ? 'mainnet' : 'testnet',
  });
  if (!signed) throw new Error('Signing was cancelled.');
  return nearApi.sign(bundle.event.id, { publicKey: signed.publicKey, signature: signed.signature });
}

type LoginChallenge = { message: string; nonce: string; recipient: string; network: string };

// "Continue with NEAR": the wallet signs a one-use sign-in message (no transaction, no fee). The
// API checks it and that the key is a full-access key of the account, then starts a session.
export async function signInWithNear() {
  const challenge = await authClient.$fetch<LoginChallenge>('/near/challenge', { method: 'POST', body: {} });
  if (challenge.error || !challenge.data) throw new Error(challenge.error?.message || 'NEAR sign-in is unavailable.');
  const { network, message, nonce, recipient } = challenge.data;
  const { wallet } = await connectedWallet(network);
  const signed = await wallet.signMessage({
    message,
    recipient,
    nonce: hexBytes(nonce),
    network: network === 'mainnet' ? 'mainnet' : 'testnet',
  });
  if (!signed) throw new Error('Signing was cancelled.');
  const verified = await authClient.$fetch('/near/verify', {
    method: 'POST',
    body: { nonce, accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature },
  });
  if (verified.error) throw new Error(verified.error.message || 'NEAR sign-in failed.');
}
