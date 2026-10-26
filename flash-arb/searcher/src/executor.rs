use ethers::prelude::*;
use tracing::{info, warn};
use std::sync::Arc;
use crate::config::ChainConfig;
use crate::routes::ArbitrageOpportunity;
use crate::sim::SimulationResult;
use crate::risk::RiskManager;

pub struct TxExecutor {
    pub config: ChainConfig,
    pub risk_manager: RiskManager,
}

impl TxExecutor {
    pub fn new(config: ChainConfig, risk_manager: RiskManager) -> Self {
        Self { config, risk_manager }
    }

    /// Prepares EIP-1559 transaction, encodes contract ABI calldata, sets sequencer priority fee tip,
    /// signs via LocalWallet from FLASH_ARB_SIGNER_KEY, and dispatches to RPC/Relay.
    pub async fn execute_or_dry_run(
        &self,
        opp: &ArbitrageOpportunity,
        sim: &SimulationResult,
        live_eth_price: f64,
    ) -> eyre::Result<()> {
        let expected_net_usd = opp.net_profit_usd;

        // 1. Check Dry-Run Mode
        if self.config.risk.dry_run {
            info!(
                "🎯 [DRY-RUN LOG] Would have executed FlashArb on {}! \
                 Asset: {} | Borrow: {} | Spread: {:.2} bps | Sim Gas: {} | Est Net Profit: ${:.2}",
                self.config.chain_name,
                opp.asset_symbol,
                opp.optimal_loan_amount,
                opp.spread_bps,
                sim.gas_used,
                expected_net_usd
            );
            // In dry-run mode, DO NOT broadcast or record fake on-chain success
            return Ok(());
        }

        // 2. Pre-execution Risk Check
        if let Err(reason) = self.risk_manager.can_execute(&format!("{:?}", opp.borrowed_asset), sim.gas_used).await {
            warn!("[{}] Risk check rejected trade: {}", self.config.chain_name, reason);
            return Ok(());
        }

        // 3. Dynamic Sequencer Priority Fee Bidding (Pay share of profit as miner tip on L2)
        let tip_fraction = (self.config.tip_share_percent as f64) / 100.0;
        let tip_usd = expected_net_usd * tip_fraction;
        let eth_price = if live_eth_price > 50.0 { live_eth_price } else { 2850.0 };
        let tip_eth = tip_usd / eth_price;
        let priority_fee_per_gas = ((tip_eth * 1e18) / (sim.gas_used as f64)) as u64;

        info!(
            "[{}] Bidding {:.0}% of profit as Sequencer Priority Tip: ${:.2} ({} wei/gas @ ETH ${:.2})",
            self.config.chain_name,
            self.config.tip_share_percent,
            tip_usd,
            priority_fee_per_gas,
            eth_price
        );

        // 4. Construct Real ABI Calldata for FlashArbOptimized / FlashArb
        // Resolves profit recipient: 100% of realized alpha routes directly here
        let profit_recipient = std::env::var("FLASH_ARB_PROFIT_WALLET")
            .unwrap_or_else(|_| "0xc102BB3848DD0397dEB6C655721F756Aa9F9f15d".to_string())
            .parse::<Address>()?;

        let min_profit_wei = opp.expected_gross_profit / 2; // conservative on-chain slippage guard

        // Encode routing params: (address poolA, address poolB, uint256 minProfit, address recipient)
        let user_data = ethers::abi::encode(&[
            ethers::abi::Token::Address(opp.buy_pool),
            ethers::abi::Token::Address(opp.sell_pool),
            ethers::abi::Token::Uint(min_profit_wei),
            ethers::abi::Token::Address(profit_recipient),
        ]);

        // Function selector for executeBalancerFlashArb(address,uint256,bytes)
        let function_selector = ethers::utils::id("executeBalancerFlashArb(address,uint256,bytes)");
        let mut calldata = Vec::new();
        calldata.extend_from_slice(&function_selector[0..4]);
        let encoded_args = ethers::abi::encode(&[
            ethers::abi::Token::Address(opp.borrowed_asset),
            ethers::abi::Token::Uint(opp.optimal_loan_amount),
            ethers::abi::Token::Bytes(user_data),
        ]);
        calldata.extend_from_slice(&encoded_args);
        let calldata_bytes = Bytes::from(calldata);

        // 5. Check Signer Configuration
        let signer_key_str = match std::env::var("FLASH_ARB_SIGNER_KEY") {
            Ok(k) if !k.trim().is_empty() => k.trim().to_string(),
            _ => {
                let gas_wallet = std::env::var("FLASH_ARB_GAS_WALLET")
                    .unwrap_or_else(|_| "0xF1d765d693f9e6fAb0c4a2FCa942d9D54233C966".to_string());
                warn!(
                    "[{}] FLASH_ARB_SIGNER_KEY not configured! Cannot sign transaction. Gas wallet: {}",
                    self.config.chain_name, gas_wallet
                );
                eyre::bail!("Searcher signer private key not configured. Set FLASH_ARB_SIGNER_KEY.");
            }
        };

        let wallet: LocalWallet = signer_key_str.parse::<LocalWallet>()?.with_chain_id(self.config.chain_id);
        let signer_address = wallet.address();
        info!(
            "[{}] Loaded searcher signer: {:?} (Profit Recipient: {:?})",
            self.config.chain_name, signer_address, profit_recipient
        );

        // 6. Connect Provider and Signer Middleware
        let provider = Provider::<Http>::try_from(&self.config.rpc_http)?;
        let client = Arc::new(SignerMiddleware::new(provider.clone(), wallet));
        let contract_address = self.config.flash_arb_contract.parse::<Address>()?;

        // 7. Build Real EIP-1559 Transaction Request
        let (max_fee_per_gas, _) = provider
            .estimate_eip1559_fees(None)
            .await
            .unwrap_or((U256::from(200_000_000), U256::from(50_000_000)));

        let tx_request = Eip1559TransactionRequest::new()
            .to(contract_address)
            .from(signer_address)
            .data(calldata_bytes)
            .gas(sim.gas_used + 50_000)
            .max_priority_fee_per_gas(U256::from(priority_fee_per_gas))
            .max_fee_per_gas(max_fee_per_gas + U256::from(priority_fee_per_gas))
            .chain_id(self.config.chain_id);

        info!(
            "[{}] Broadcasting live transaction to node {} / relay {}...",
            self.config.chain_name, self.config.rpc_http, self.config.relay_endpoint
        );

        // 8. Broadcast Live Transaction on Chain
        let pending_tx = client.send_transaction(tx_request, None).await?;
        let tx_hash = pending_tx.tx_hash();
        info!("🚀 [{}] Broadcasted! Tx Hash: 0x{:x}", self.config.chain_name, tx_hash);

        // 9. Await Real On-Chain Confirmation Receipt
        match pending_tx.await? {
            Some(receipt) => {
                if receipt.status == Some(U64::from(1)) {
                    info!(
                        "🎉 [{}] FlashArb CONFIRMED ON-CHAIN! Block #{} | Gas Used: {:?} | Profit Swept: ${:.2}",
                        self.config.chain_name,
                        receipt.block_number.unwrap_or_default(),
                        receipt.gas_used.unwrap_or_default(),
                        expected_net_usd
                    );
                    self.risk_manager.record_success();
                } else {
                    let gas_used = receipt.gas_used.unwrap_or_default().as_u64();
                    let gas_loss_usd = (gas_used as f64 * 0.1e-9) * eth_price;
                    warn!(
                        "⚠️ [{}] FlashArb transaction reverted on-chain! Gas loss: ${:.2}",
                        self.config.chain_name, gas_loss_usd
                    );
                    self.risk_manager.record_revert(gas_loss_usd).await;
                }
            }
            None => {
                warn!("[{}] Transaction dropped or not mined in timeout window", self.config.chain_name);
            }
        }

        Ok(())
    }
}
