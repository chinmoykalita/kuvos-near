//! Kuvos anchor contract.
//!
//! Stores only opaque hashes: Merkle roots of salted care-event commitments and the hashes of
//! published Tomo gate rule versions. No patient identity, care text or health data is ever
//! written here. Write methods may only be called by the contract account itself, so the
//! Kuvos publisher holds a function-call access key restricted to `anchor` and `publish_policy`.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

const MAX_ID_LEN: usize = 64;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Batches,
    Policies,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Batch {
    /// Lowercase hex SHA-256 Merkle root over salted event digests.
    pub root: String,
    pub count: u32,
    pub block_height: u64,
    pub timestamp_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    /// Lowercase hex SHA-256 of the canonical rules document.
    pub hash: String,
    pub block_height: u64,
    pub timestamp_ns: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct KuvosAnchor {
    batches: LookupMap<String, Batch>,
    policies: LookupMap<u32, Policy>,
    batch_count: u64,
    latest_policy: Option<u32>,
}

fn require_hex32(value: &str, label: &str) {
    require!(
        value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        format!("{label} must be 64 lowercase hex characters")
    );
}

fn emit(event: &str, data: String) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"kuvos-anchor\",\"version\":\"1.0.0\",\"event\":\"{event}\",\"data\":[{data}]}}"
    ));
}

#[near]
impl KuvosAnchor {
    #[init]
    pub fn new() -> Self {
        Self {
            batches: LookupMap::new(StorageKey::Batches),
            policies: LookupMap::new(StorageKey::Policies),
            batch_count: 0,
            latest_policy: None,
        }
    }

    fn require_self(&self) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only the contract account can write"
        );
    }

    /// Anchors one Merkle root. Idempotent: resending the same batch returns the stored record,
    /// so a publisher that crashed after submitting can safely retry. A different root for an
    /// existing batch id is rejected.
    pub fn anchor(&mut self, batch_id: String, root: String, count: u32) -> Batch {
        self.require_self();
        require!(!batch_id.is_empty() && batch_id.len() <= MAX_ID_LEN, "Invalid batch id");
        require_hex32(&root, "root");
        require!(count > 0, "Empty batch");
        if let Some(existing) = self.batches.get(&batch_id) {
            require!(existing.root == root && existing.count == count, "Batch id already anchored with a different root");
            return existing.clone();
        }
        let batch = Batch {
            root: root.clone(),
            count,
            block_height: env::block_height(),
            timestamp_ns: env::block_timestamp(),
        };
        self.batches.insert(batch_id.clone(), batch.clone());
        self.batch_count += 1;
        emit("anchor", format!("{{\"batch_id\":\"{batch_id}\",\"root\":\"{root}\",\"count\":{count}}}"));
        batch
    }

    /// Publishes an immutable Tomo gate rules version. Republishing the same hash is a no-op;
    /// a version can never be changed, only superseded by a higher version.
    pub fn publish_policy(&mut self, version: u32, hash: String) -> Policy {
        self.require_self();
        require!(version > 0, "Version starts at 1");
        require_hex32(&hash, "hash");
        if let Some(existing) = self.policies.get(&version) {
            require!(existing.hash == hash, "Policy version is immutable");
            return existing.clone();
        }
        let policy = Policy {
            hash: hash.clone(),
            block_height: env::block_height(),
            timestamp_ns: env::block_timestamp(),
        };
        self.policies.insert(version, policy.clone());
        if self.latest_policy.map_or(true, |latest| version > latest) {
            self.latest_policy = Some(version);
        }
        emit("publish_policy", format!("{{\"version\":{version},\"hash\":\"{hash}\"}}"));
        policy
    }

    pub fn get_batch(&self, batch_id: String) -> Option<Batch> {
        self.batches.get(&batch_id).cloned()
    }

    pub fn get_policy(&self, version: u32) -> Option<Policy> {
        self.policies.get(&version).cloned()
    }

    pub fn latest_policy(&self) -> Option<u32> {
        self.latest_policy
    }

    pub fn batch_count(&self) -> u64 {
        self.batch_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ROOT: &str = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";
    const OTHER: &str = "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35";

    fn context(predecessor: &str) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("anchor.kuvos.testnet".parse::<AccountId>().unwrap())
            .predecessor_account_id(predecessor.parse::<AccountId>().unwrap());
        testing_env!(builder.build());
    }

    #[test]
    fn anchors_once_and_is_idempotent() {
        context("anchor.kuvos.testnet");
        let mut contract = KuvosAnchor::new();
        let first = contract.anchor("b1".into(), ROOT.into(), 3);
        let again = contract.anchor("b1".into(), ROOT.into(), 3);
        assert_eq!(first, again);
        assert_eq!(contract.batch_count(), 1);
        assert_eq!(contract.get_batch("b1".into()).unwrap().root, ROOT);
    }

    #[test]
    #[should_panic(expected = "different root")]
    fn rejects_changed_root() {
        context("anchor.kuvos.testnet");
        let mut contract = KuvosAnchor::new();
        contract.anchor("b1".into(), ROOT.into(), 3);
        contract.anchor("b1".into(), OTHER.into(), 3);
    }

    #[test]
    #[should_panic(expected = "Only the contract account")]
    fn rejects_other_callers() {
        context("anchor.kuvos.testnet");
        let mut contract = KuvosAnchor::new();
        context("someone.testnet");
        contract.anchor("b1".into(), ROOT.into(), 1);
    }

    #[test]
    #[should_panic(expected = "64 lowercase hex")]
    fn rejects_non_hash_payloads() {
        context("anchor.kuvos.testnet");
        let mut contract = KuvosAnchor::new();
        contract.anchor("b1".into(), "patient name".into(), 1);
    }

    #[test]
    fn policies_are_immutable_versions() {
        context("anchor.kuvos.testnet");
        let mut contract = KuvosAnchor::new();
        contract.publish_policy(1, ROOT.into());
        contract.publish_policy(1, ROOT.into());
        contract.publish_policy(2, OTHER.into());
        assert_eq!(contract.latest_policy(), Some(2));
        assert_eq!(contract.get_policy(1).unwrap().hash, ROOT);
    }

    #[test]
    #[should_panic(expected = "immutable")]
    fn policy_cannot_change() {
        context("anchor.kuvos.testnet");
        let mut contract = KuvosAnchor::new();
        contract.publish_policy(1, ROOT.into());
        contract.publish_policy(1, OTHER.into());
    }
}
