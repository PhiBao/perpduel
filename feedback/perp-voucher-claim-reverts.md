# SDK `claimPerpVoucher` reverts while `getPerpVoucherEligibility` reports eligible
Severity: major
Area: SDK | contracts

## Steps to reproduce
1. Fresh EOA on Somnia Hideki testnet (50383) with STT for gas, no perp positions, no resting orders.
2. With `@somnia-chain/markets-sdk` 0.32.1:
   - `client.getPerpVoucherEligibility(marginBank, account)` → `{ eligible: true, grantAmount: 1000 USDso }`
   - `client.getPerpVoucher(marginBank, account)` → `{ claimed: false, floor: 0, expiresAt: 0 }`
   - `client.getPerpVoucherCampaign(marginBank)` → campaign active (`startsAt 1790553600`, `endsAt 1798477478`, `budgetRemaining 207,585,000 USDso`, `claimsRemaining 207585`, distributor `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4`)
3. Call `trader.claimPerpVoucher({ marginBank })`.

Reproduced identically on two independent fresh EOAs (one with an existing 99.9 USDso MarginBank balance, one completely fresh).

## Expected
Claim succeeds and credits the 1,000 USDso voucher, as the eligibility read, the campaign read, and https://app.testnet.dreamdex.io/docs/developers/perps-testnet ("Any address can claim the 1,000 USDso perps credit once") all indicate.

## Actual
Transaction reverts: `ContractRevertError … claim reverted: for an unknown reason`, revert data `0x3e31dcc2`, calling `claim()` (`0x4e71d92d`) on VoucherDistributor `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4`. The selector `0x3e31dcc2` does not decode against the SDK's bundled contract-error ABIs (546 error signatures checked, including `AlreadyClaimed()`, `CampaignInactive()`, `NothingToClaim()`), so the SDK surfaces no actionable reason.

## Evidence
- SDK: `@somnia-chain/markets-sdk@0.32.1`, Node 22, chain 50383
- Wallet A (has margin balance): `0xDbFe5c4d0256D2459bB216caB905999Ca41bE349`
- Wallet B (fresh): `0xd5fDBFe944e059eCa20e8192473F8c7497445EfF`
- Workaround used: fund the second wallet by withdrawing USDso from wallet A's MarginBank, ERC-20 transfer, and `depositMargin` — all succeed, so MarginBank deposit/withdraw paths are healthy; only the voucher claim path fails.

## Environment
SDK version 0.32.1, network (Somnia Hideki testnet 50383), wallets above.
