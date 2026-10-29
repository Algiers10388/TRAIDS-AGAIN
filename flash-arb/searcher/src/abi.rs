//! Minimal, dependency-light ABI helpers.
//!
//! Everything here is plain `eth_call` with hand-encoded calldata, so there are no macro-generated
//! names to depend on and the encoding of the FlashArb entrypoint is explicit and auditable.

use ethers::abi::{self, ParamType, Token};
use ethers::prelude::*;
use ethers::types::transaction::eip2718::TypedTransaction;
use ethers::utils::id;

use crate::config::DexKind;

/// Must match the Solidity enum `FlashArb.DexProtocol` exactly.
pub fn protocol_id(kind: DexKind) -> u8 {
    match kind {
        DexKind::V2 => 0,
        DexKind::V3 => 1,
        DexKind::Curve => 2,
        DexKind::V3Router02 => 3,
        DexKind::Solidly => 4,
    }
}

pub fn encode_call(signature: &str, args: &[Token]) -> Bytes {
    let mut data = id(signature).to_vec();
    data.extend_from_slice(&abi::encode(args));
    Bytes::from(data)
}

pub async fn raw_call(
    provider: &Provider<Http>,
    to: Address,
    data: Bytes,
    from: Option<Address>,
) -> eyre::Result<Bytes> {
    let mut req = TransactionRequest::new().to(to).data(data);
    if let Some(f) = from {
        req = req.from(f);
    }
    let tx: TypedTransaction = req.into();
    Ok(provider.call(&tx, None).await?)
}

async fn call_decode(
    provider: &Provider<Http>,
    to: Address,
    signature: &str,
    args: &[Token],
    outputs: &[ParamType],
) -> eyre::Result<Vec<Token>> {
    let out = raw_call(provider, to, encode_call(signature, args), None).await?;
    Ok(abi::decode(outputs, &out)?)
}

fn first_address(tokens: Vec<Token>) -> eyre::Result<Address> {
    tokens
        .into_iter()
        .next()
        .and_then(|t| t.into_address())
        .ok_or_else(|| eyre::eyre!("unexpected ABI response (address expected)"))
}

fn first_uint(tokens: Vec<Token>) -> eyre::Result<U256> {
    tokens
        .into_iter()
        .next()
        .and_then(|t| t.into_uint())
        .ok_or_else(|| eyre::eyre!("unexpected ABI response (uint expected)"))
}

// ---- ERC20 / ownership -------------------------------------------------------------------------

pub async fn erc20_decimals(p: &Provider<Http>, token: Address) -> eyre::Result<u8> {
    let v = first_uint(call_decode(p, token, "decimals()", &[], &[ParamType::Uint(8)]).await?)?;
    Ok(v.as_u32() as u8)
}

pub async fn contract_owner(p: &Provider<Http>, c: Address) -> eyre::Result<Address> {
    first_address(call_decode(p, c, "owner()", &[], &[ParamType::Address]).await?)
}

pub async fn contract_pool(p: &Provider<Http>, c: Address) -> eyre::Result<Address> {
    first_address(call_decode(p, c, "POOL()", &[], &[ParamType::Address]).await?)
}

// ---- pool discovery ----------------------------------------------------------------------------

pub async fn v2_get_pair(p: &Provider<Http>, factory: Address, a: Address, b: Address) -> eyre::Result<Address> {
    first_address(
        call_decode(p, factory, "getPair(address,address)", &[Token::Address(a), Token::Address(b)], &[ParamType::Address]).await?,
    )
}

pub async fn v3_get_pool(p: &Provider<Http>, factory: Address, a: Address, b: Address, fee: u32) -> eyre::Result<Address> {
    first_address(
        call_decode(
            p,
            factory,
            "getPool(address,address,uint24)",
            &[Token::Address(a), Token::Address(b), Token::Uint(U256::from(fee))],
            &[ParamType::Address],
        )
        .await?,
    )
}

pub async fn v3_liquidity(p: &Provider<Http>, pool: Address) -> eyre::Result<U256> {
    first_uint(call_decode(p, pool, "liquidity()", &[], &[ParamType::Uint(128)]).await?)
}

pub async fn solidly_get_pool(p: &Provider<Http>, factory: Address, a: Address, b: Address, stable: bool) -> eyre::Result<Address> {
    first_address(
        call_decode(
            p,
            factory,
            "getPool(address,address,bool)",
            &[Token::Address(a), Token::Address(b), Token::Bool(stable)],
            &[ParamType::Address],
        )
        .await?,
    )
}

// ---- quoting (all on-chain, exact for the current block) ---------------------------------------

pub async fn v2_amount_out(p: &Provider<Http>, router: Address, amount_in: U256, a: Address, b: Address) -> eyre::Result<U256> {
    let toks = call_decode(
        p,
        router,
        "getAmountsOut(uint256,address[])",
        &[Token::Uint(amount_in), Token::Array(vec![Token::Address(a), Token::Address(b)])],
        &[ParamType::Array(Box::new(ParamType::Uint(256)))],
    )
    .await?;
    let arr = toks.into_iter().next().and_then(|t| t.into_array()).ok_or_else(|| eyre::eyre!("bad getAmountsOut"))?;
    arr.last().cloned().and_then(|t| t.into_uint()).ok_or_else(|| eyre::eyre!("empty getAmountsOut"))
}

pub async fn v3_amount_out(
    p: &Provider<Http>,
    quoter: Address,
    quoter_v2: bool,
    a: Address,
    b: Address,
    fee: u32,
    amount_in: U256,
) -> eyre::Result<U256> {
    if quoter_v2 {
        // QuoterV2.quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96))
        let params = Token::Tuple(vec![
            Token::Address(a),
            Token::Address(b),
            Token::Uint(amount_in),
            Token::Uint(U256::from(fee)),
            Token::Uint(U256::zero()),
        ]);
        let toks = call_decode(
            p,
            quoter,
            "quoteExactInputSingle((address,address,uint256,uint24,uint160))",
            &[params],
            &[ParamType::Uint(256), ParamType::Uint(160), ParamType::Uint(32), ParamType::Uint(256)],
        )
        .await?;
        first_uint(toks)
    } else {
        let toks = call_decode(
            p,
            quoter,
            "quoteExactInputSingle(address,address,uint24,uint256,uint160)",
            &[
                Token::Address(a),
                Token::Address(b),
                Token::Uint(U256::from(fee)),
                Token::Uint(amount_in),
                Token::Uint(U256::zero()),
            ],
            &[ParamType::Uint(256)],
        )
        .await?;
        first_uint(toks)
    }
}

pub async fn solidly_amount_out(
    p: &Provider<Http>,
    router: Address,
    factory: Address,
    a: Address,
    b: Address,
    stable: bool,
    amount_in: U256,
) -> eyre::Result<U256> {
    let route = Token::Tuple(vec![Token::Address(a), Token::Address(b), Token::Bool(stable), Token::Address(factory)]);
    let toks = call_decode(
        p,
        router,
        "getAmountsOut(uint256,(address,address,bool,address)[])",
        &[Token::Uint(amount_in), Token::Array(vec![route])],
        &[ParamType::Array(Box::new(ParamType::Uint(256)))],
    )
    .await?;
    let arr = toks.into_iter().next().and_then(|t| t.into_array()).ok_or_else(|| eyre::eyre!("bad getAmountsOut"))?;
    arr.last().cloned().and_then(|t| t.into_uint()).ok_or_else(|| eyre::eyre!("empty getAmountsOut"))
}

// ---- FlashArb.executeFlashArb calldata ---------------------------------------------------------

const LEG_SIG: &str = "(uint8,address,address,address,uint24,int128,int128,address,bool)";

#[derive(Debug, Clone)]
pub struct LegParams {
    pub protocol: u8,
    pub router_or_pool: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub v3_fee: u32,
    pub factory: Address,
    pub stable: bool,
}

fn leg_token(l: &LegParams) -> Token {
    Token::Tuple(vec![
        Token::Uint(U256::from(l.protocol)),
        Token::Address(l.router_or_pool),
        Token::Address(l.token_in),
        Token::Address(l.token_out),
        Token::Uint(U256::from(l.v3_fee)),
        Token::Int(U256::zero()), // curveIndexIn (unused outside CURVE legs)
        Token::Int(U256::zero()), // curveIndexOut
        Token::Address(l.factory),
        Token::Bool(l.stable),
    ])
}

pub fn encode_execute_flash_arb(
    asset: Address,
    amount: U256,
    min_profit: U256,
    leg1: &LegParams,
    leg2: &LegParams,
    profit_recipient: Address,
) -> Bytes {
    let sig = format!(
        "executeFlashArb(address,uint256,(uint256,{leg},{leg},address))",
        leg = LEG_SIG
    );
    let params = Token::Tuple(vec![
        Token::Uint(min_profit),
        leg_token(leg1),
        leg_token(leg2),
        Token::Address(profit_recipient),
    ]);
    encode_call(&sig, &[Token::Address(asset), Token::Uint(amount), params])
}
