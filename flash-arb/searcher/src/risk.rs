use std::sync::atomic::{AtomicU32, AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{warn, error};
use crate::config::RiskConfig;

#[derive(Debug, Clone)]
pub struct RiskManager {
    pub config: RiskConfig,
    pub consecutive_reverts: Arc<AtomicU32>,
    pub circuit_breaker_tripped: Arc<AtomicBool>,
    pub daily_gas_loss_usd: Arc<RwLock<f64>>,
}

impl RiskManager {
    pub fn new(config: RiskConfig) -> Self {
        Self {
            config,
            consecutive_reverts: Arc::new(AtomicU32::new(0)),
            circuit_breaker_tripped: Arc::new(AtomicBool::new(false)),
            daily_gas_loss_usd: Arc::new(RwLock::new(0.0)),
        }
    }

    /// Pre-execution safety check
    pub async fn can_execute(&self, token_address: &str, gas_units: u64) -> Result<(), &'static str> {
        // 1. Check Circuit Breaker
        if self.circuit_breaker_tripped.load(Ordering::SeqCst) {
            return Err("Circuit breaker is TRIPPED due to consecutive reverts");
        }

        // 2. Token Allowlist: Exclude fee-on-transfer or rebasing tokens
        let clean_addr = token_address.to_lowercase();
        for excluded in &self.config.excluded_tokens {
            if excluded.to_lowercase() == clean_addr {
                return Err("Token is in the excluded/rebasing/fee-on-transfer blacklist");
            }
        }

        // 3. Max Gas Cap Per Tx
        if gas_units > self.config.max_gas_per_tx {
            return Err("Estimated gas units exceed max_gas_per_tx limit");
        }

        // 4. Daily Gas Loss Cap
        let daily_loss = *self.daily_gas_loss_usd.read().await;
        if daily_loss >= self.config.daily_revert_loss_cap_usd {
            self.circuit_breaker_tripped.store(true, Ordering::SeqCst);
            return Err("Daily revert gas loss cap exceeded. Emergency Kill Switch engaged.");
        }

        Ok(())
    }

    /// Records successful execution: resets consecutive revert counter
    pub fn record_success(&self) {
        self.consecutive_reverts.store(0, Ordering::SeqCst);
    }

    /// Records revert: increments failure count and tracks lost gas dollar value
    pub async fn record_revert(&self, gas_spent_usd: f64) {
        let fails = self.consecutive_reverts.fetch_add(1, Ordering::SeqCst) + 1;
        warn!("Recorded on-chain revert #{}. Gas lost: ${:.2}", fails, gas_spent_usd);

        let mut daily_loss = self.daily_gas_loss_usd.write().await;
        *daily_loss += gas_spent_usd;

        // Trip Circuit Breaker if consecutive failures exceed limit
        if fails >= self.config.consecutive_failure_limit {
            error!(
                "CIRCUIT BREAKER TRIPPED! {} consecutive reverts reached. Halting automated execution.",
                fails
            );
            self.circuit_breaker_tripped.store(true, Ordering::SeqCst);
        }

        // Check Daily Cap
        if *daily_loss >= self.config.daily_revert_loss_cap_usd {
            error!(
                "DAILY LOSS CAP REACHED! Total gas lost: ${:.2} (Limit: ${:.2}). Halting searcher.",
                *daily_loss, self.config.daily_revert_loss_cap_usd
            );
            self.circuit_breaker_tripped.store(true, Ordering::SeqCst);
        }
    }

    /// Manual or automated reset of the circuit breaker
    pub fn reset_circuit_breaker(&self) {
        self.consecutive_reverts.store(0, Ordering::SeqCst);
        self.circuit_breaker_tripped.store(false, Ordering::SeqCst);
    }
}
