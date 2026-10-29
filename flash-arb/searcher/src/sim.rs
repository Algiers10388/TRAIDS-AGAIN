//! Pre-flight simulation against the live chain state.
//!
//! The exact calldata that would be broadcast is run through `eth_call` (which executes the whole
//! flash loan, both swaps, the repayment and the contract's own `minProfit` check) and then gas is
//! estimated. If either fails the trade is dropped; nothing is sent.

use ethers::prelude::*;
use ethers::types::transaction::eip2718::TypedTransaction;

pub async fn simulate(
    provider: &Provider<Http>,
    from: Address,
    contract: Address,
    calldata: Bytes,
) -> Result<u64, String> {
    let tx: TypedTransaction = TransactionRequest::new().from(from).to(contract).data(calldata).into();
    provider.call(&tx, None).await.map_err(|e| format!("eth_call reverted: {}", e))?;
    let gas = provider
        .estimate_gas(&tx, None)
        .await
        .map_err(|e| format!("estimateGas failed: {}", e))?;
    Ok(gas.as_u64())
}
