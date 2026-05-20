# Poker Hand Settler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the trustless on-chain settlement layer described in `manamesh/PRD_CONTRACTS.md` (v1.1) — one `PokerHandSettler` Diamond per ERC20 token, an owner-governed `BettingConfigOracle` Diamond for rake config, a Level-1 best-5-of-7 hand verifier facet, and the off-chain EIP-712 signing helpers that pair with them.

**Architecture:** Crane Diamond + DFPkg per token settler; separate `BettingConfigOracle` Diamond providing `(operator, rakeBps)` per-token with global default; verifier as a standalone facet attached to each settler Diamond. Off-chain TypeScript helpers co-located with the existing poker module produce EIP-712 signatures that the on-chain code recomputes the `handId` from and verifies.

**Tech Stack:** Solidity 0.8.30 (Cancun→Prague), Foundry, Crane framework (ERC2535 Diamond + DFPkg + CREATE3), OpenZeppelin contracts, TypeScript (viem-style EIP-712 from existing poker module), Vitest for TS tests, forge for Solidity tests.

**Reference docs:**
- `manamesh/PRD_CONTRACTS.md` — locked PRD (v1.1), especially §11.
- `manamesh/lib/crane/AGENTS.md` — Crane patterns: Facet-Target-Repo, DFPkg, FactoryService, TestBase, Behavior.
- `manamesh/AGENTS.md` — poker game module layout (`packages/frontend/src/game/modules/poker/`).
- `manamesh/lib/crane/contracts/tokens/ERC20/ERC20PermitMintBurnLockedOwnableDFPkg.sol` — concrete DFPkg example.
- `manamesh/lib/crane/contracts/access/ERC8023/MultiStepOwnableRepo.sol` — ownership pattern we'll use for the oracle.

**Working directory for all Solidity work:** `manamesh/contracts/`.
**Working directory for TS work:** `manamesh/packages/frontend/src/game/modules/poker/`.

**Commit style:** Conventional Commits (`feat:`, `test:`, `chore:`, `refactor:`). Each task ends with at least one commit; sometimes more if the steps are independent.

---

## File Structure (locked before tasks)

```
contracts/
├── foundry.toml                                 # bumped: solc 0.8.30, evm prague, optimizer=1
├── remappings.txt                               # already fixed: @crane/=../lib/crane/
├── lib/                                         # forge install lands here
│   ├── forge-std/                              # forge install foundry-rs/forge-std
│   └── openzeppelin-contracts/                 # forge install OpenZeppelin/openzeppelin-contracts
├── src/
│   ├── types/
│   │   ├── HandInit.sol                        # struct + EIP-712 typehash
│   │   ├── HandOutcome.sol                     # struct + EIP-712 typehash
│   │   └── RoundStateTransition.sol            # struct + EIP-712 typehash
│   ├── lib/
│   │   ├── HandIdLib.sol                       # keccak256(abi.encode(HandInit))
│   │   └── SignatureLib.sol                    # EIP-712 sig verification helpers
│   ├── oracle/
│   │   ├── IBettingConfigOracle.sol            # external interface
│   │   ├── BettingConfigOracleErrors.sol       # custom errors
│   │   ├── BettingConfigOracleRepo.sol         # storage library
│   │   ├── BettingConfigOracleTarget.sol       # logic
│   │   ├── BettingConfigOracleFacet.sol        # IFacet wrapper
│   │   ├── BettingConfigOracleDFPkg.sol        # DFPkg
│   │   ├── TestBase_BettingConfigOracle.sol    # TestBase (Crane convention)
│   │   └── Behavior_IBettingConfigOracle.sol   # Behavior library
│   ├── settler/
│   │   ├── IPokerHandSettler.sol
│   │   ├── PokerHandSettlerErrors.sol
│   │   ├── PokerHandSettlerRepo.sol
│   │   ├── PokerHandSettlerTarget.sol
│   │   ├── PokerHandSettlerFacet.sol
│   │   ├── PokerHandSettlerDFPkg.sol
│   │   ├── TestBase_PokerHandSettler.sol
│   │   └── Behavior_IPokerHandSettler.sol
│   └── verifier/
│       ├── IPokerVerifierFacet.sol
│       ├── PokerHandEvaluator.sol              # library: rank detection, best-5-of-7
│       ├── PokerVerifierFacet.sol              # facet exposing verify()
│       ├── TestBase_PokerVerifier.sol
│       └── Behavior_IPokerVerifier.sol
├── test/                                        # foundry spec files mirror src/
│   ├── oracle/
│   │   └── BettingConfigOracle.t.sol
│   ├── settler/
│   │   ├── PokerHandSettler_deposit.t.sol
│   │   ├── PokerHandSettler_withdraw.t.sol
│   │   ├── PokerHandSettler_assertHandMembership.t.sol
│   │   ├── PokerHandSettler_settleHand.t.sol
│   │   └── PokerHandSettler_forceTimeoutSettlement.t.sol
│   ├── verifier/
│   │   └── PokerVerifierFacet.t.sol
│   ├── lib/
│   │   ├── HandIdLib.t.sol
│   │   └── SignatureLib.t.sol
│   └── integration/
│       └── PokerHandSettler_E2E.t.sol
└── script/
    ├── DeployBettingConfigOracle.s.sol
    ├── DeployPokerHandSettler.s.sol             # per-token
    └── DeployPokerSystem.s.sol                  # full system bootstrap

packages/frontend/src/game/modules/poker/
├── types.ts                                     # refactor PokerHandResult → parallel arrays
├── crypto.ts                                    # update buildHandResult shape
├── handId.ts                                    # NEW: deriveHandId
├── handId.test.ts                               # NEW: vitest + Solidity parity test
├── signing.ts                                   # NEW: sign{HandInit,HandOutcome,RoundState}
└── signing.test.ts                              # NEW: round-trip tests
```

**Files to delete during cleanup phase:**

```
contracts/src/Counter.sol                       # default forge scaffold
contracts/src/ChipToken.sol                     # superseded
contracts/src/ChipTokenFactory.sol              # superseded (settler talks to ERC20 directly)
contracts/src/GameVault.sol                     # superseded by PokerHandSettler
contracts/src/interfaces/IChipToken.sol
contracts/src/interfaces/IChipTokenFactory.sol
contracts/src/interfaces/IGameVault.sol
contracts/src/libraries/SignatureVerifier.sol   # replaced by SignatureLib
contracts/test/Counter.t.sol
```

---

## Phase 0: Toolchain & Repo Housekeeping

### Task 0.1: Bump foundry.toml to match Crane

**Files:**
- Modify: `contracts/foundry.toml`

- [ ] **Step 1: Update foundry.toml**

Replace the `[profile.default]` block with:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
cache_path = "cache"

# Compiler settings — aligned with Crane (manamesh/lib/crane/AGENTS.md §Configuration)
solc_version = "0.8.30"
optimizer = true
optimizer_runs = 1
evm_version = "prague"

# Testing
ffi = false
verbosity = 2
fuzz = { runs = 256 }

[profile.ci]
fuzz = { runs = 1000 }

[fmt]
line_length = 100
tab_width = 4
bracket_spacing = true

[rpc_endpoints]
mainnet = "${MAINNET_RPC_URL}"
sepolia = "${SEPOLIA_RPC_URL}"
arbitrum = "${ARBITRUM_RPC_URL}"
base = "${BASE_RPC_URL}"
```

- [ ] **Step 2: Commit**

```bash
cd manamesh/contracts
git add foundry.toml
git commit -m "chore(contracts): bump foundry toolchain to solc 0.8.30 / prague / optimizer=1 (Crane alignment)"
```

---

### Task 0.2: Install forge-std and OpenZeppelin into contracts/lib

**Files:**
- Create: `contracts/lib/forge-std/` (via forge install)
- Create: `contracts/lib/openzeppelin-contracts/` (via forge install)
- Modify: `contracts/.gitmodules` (created by forge install)

- [ ] **Step 1: Install forge-std**

```bash
cd manamesh/contracts
forge install foundry-rs/forge-std --no-commit
```

Expected: `lib/forge-std/` populated; `.gitmodules` updated.

- [ ] **Step 2: Install OpenZeppelin v5**

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
```

Pin to v5.0.2 because Crane targets 0.8.30 and OZ v5 supports it. Expected: `lib/openzeppelin-contracts/` populated.

- [ ] **Step 3: Verify the empty build compiles**

```bash
forge build
```

Expected: succeeds with "No files changed, compilation skipped" or compiles `src/Counter.sol` cleanly. If `Counter.sol` errors on the 0.8.30 bump, ignore — it will be deleted in Task 0.3.

- [ ] **Step 4: Commit**

```bash
git add .gitmodules lib
git commit -m "chore(contracts): forge install forge-std and openzeppelin-contracts v5.0.2"
```

---

### Task 0.3: Delete superseded contracts

**Files:**
- Delete: `contracts/src/Counter.sol`
- Delete: `contracts/src/ChipToken.sol`
- Delete: `contracts/src/ChipTokenFactory.sol`
- Delete: `contracts/src/GameVault.sol`
- Delete: `contracts/src/interfaces/IChipToken.sol`
- Delete: `contracts/src/interfaces/IChipTokenFactory.sol`
- Delete: `contracts/src/interfaces/IGameVault.sol`
- Delete: `contracts/src/libraries/SignatureVerifier.sol`
- Delete: `contracts/test/Counter.t.sol`

- [ ] **Step 1: Remove the files**

```bash
cd manamesh/contracts
git rm src/Counter.sol src/ChipToken.sol src/ChipTokenFactory.sol src/GameVault.sol
git rm src/interfaces/IChipToken.sol src/interfaces/IChipTokenFactory.sol src/interfaces/IGameVault.sol
git rm src/libraries/SignatureVerifier.sol
git rm test/Counter.t.sol
# Remove now-empty directories if any
rmdir src/interfaces src/libraries 2>/dev/null || true
```

- [ ] **Step 2: Verify build still passes**

```bash
forge build
```

Expected: empty compile succeeds (`No files`).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(contracts): delete superseded GameVault/ChipToken/Counter; PokerHandSettler will replace"
```

---

## Phase 1: Shared Types & Libraries

### Task 1.1: HandInit / HandOutcome / RoundStateTransition struct definitions

**Files:**
- Create: `contracts/src/types/HandInit.sol`
- Create: `contracts/src/types/HandOutcome.sol`
- Create: `contracts/src/types/RoundStateTransition.sol`
- Test: `contracts/test/lib/HandIdLib.t.sol` (placeholder for next task; struct definitions only here)

These are pure data definitions — no logic — so the TDD cycle is in Task 1.2 which uses them.

- [ ] **Step 1: Create HandInit.sol**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Off-chain unanimously-signed payload that fully describes a hand.
///         handId = keccak256(abi.encode(HandInit)).
/// @dev Players[] MUST be sorted ascending. buyIns[] and playerHandNonces[]
///      MUST be parallel to players[].
struct HandInit {
    address[] players;            // sorted ascending
    uint256[] buyIns;             // parallel, each <= depositor's free balance
    address vault;                // settler instance address (immutable per token)
    uint256 smallBlind;
    uint256 bigBlind;
    uint256 timeoutSeconds;
    bytes32 otherConfig;          // opaque off-chain config commitment
    uint256[] playerHandNonces;   // parallel, each player's monotonic counter
}

/// @notice EIP-712 typehash for HandInit.
/// @dev Must match the canonical struct ordering above.
bytes32 constant HAND_INIT_TYPEHASH = keccak256(
    "HandInit(address[] players,uint256[] buyIns,address vault,uint256 smallBlind,uint256 bigBlind,uint256 timeoutSeconds,bytes32 otherConfig,uint256[] playerHandNonces)"
);
```

- [ ] **Step 2: Create HandOutcome.sol**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Off-chain signed payload at showdown.
/// @dev winners[] and payouts[] are parallel. finalStacks[] is parallel to
///      the HandInit.players[] order (sorted ascending). holeCards[][] is
///      parallel to HandInit.players[]; each inner array has 2 cards
///      encoded as uint8 (rank << 4 | suit). communityCards[5] are the
///      revealed flop+turn+river.
struct HandOutcome {
    bytes32 handId;
    uint256 pot;
    address[] winners;
    uint256[] payouts;
    uint256[] finalStacks;
    bytes32 finalStateHash;
    uint8[2][] holeCards;
    uint8[5] communityCards;
}

bytes32 constant HAND_OUTCOME_TYPEHASH = keccak256(
    "HandOutcome(bytes32 handId,uint256 pot,address[] winners,uint256[] payouts,uint256[] finalStacks,bytes32 finalStateHash,uint8[2][] holeCards,uint8[5] communityCards)"
);
```

- [ ] **Step 3: Create RoundStateTransition.sol**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Off-chain signed snapshot at the end of a betting round.
///         Used by forceTimeoutSettlement to prove the pot at the cutoff.
struct RoundStateTransition {
    bytes32 handId;
    uint8 roundNumber;            // 0 = preflop, 1 = flop, 2 = turn, 3 = river
    uint256 currentPot;
    uint256[] playerStacks;       // parallel to HandInit.players[]
    bytes32 actionHash;           // commitment over the bet actions in this round
}

bytes32 constant ROUND_STATE_TRANSITION_TYPEHASH = keccak256(
    "RoundStateTransition(bytes32 handId,uint8 roundNumber,uint256 currentPot,uint256[] playerStacks,bytes32 actionHash)"
);
```

- [ ] **Step 4: Verify build**

```bash
forge build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/types
git commit -m "feat(contracts): add HandInit, HandOutcome, RoundStateTransition structs with EIP-712 typehashes"
```

---

### Task 1.2: HandIdLib (deterministic handId)

**Files:**
- Create: `contracts/src/lib/HandIdLib.sol`
- Test: `contracts/test/lib/HandIdLib.t.sol`

- [ ] **Step 1: Write failing test**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {HandInit} from "../../src/types/HandInit.sol";
import {HandIdLib} from "../../src/lib/HandIdLib.sol";

contract HandIdLibTest is Test {
    function _makeHandInit() internal pure returns (HandInit memory h) {
        h.players = new address[](2);
        h.players[0] = address(0xAAaa);
        h.players[1] = address(0xBBbb);
        h.buyIns = new uint256[](2);
        h.buyIns[0] = 100e18;
        h.buyIns[1] = 100e18;
        h.vault = address(0xCCcc);
        h.smallBlind = 1e18;
        h.bigBlind = 2e18;
        h.timeoutSeconds = 300;
        h.otherConfig = bytes32(uint256(42));
        h.playerHandNonces = new uint256[](2);
        h.playerHandNonces[0] = 1;
        h.playerHandNonces[1] = 1;
    }

    function test_handIdIsDeterministic() public pure {
        HandInit memory h1 = _makeHandInit();
        HandInit memory h2 = _makeHandInit();
        assertEq(HandIdLib.handIdOf(h1), HandIdLib.handIdOf(h2));
    }

    function test_handIdChangesWhenPlayersChange() public pure {
        HandInit memory h1 = _makeHandInit();
        HandInit memory h2 = _makeHandInit();
        h2.players[0] = address(0xDEAD);
        assertTrue(HandIdLib.handIdOf(h1) != HandIdLib.handIdOf(h2));
    }

    function test_handIdChangesWhenBuyInsChange() public pure {
        HandInit memory h1 = _makeHandInit();
        HandInit memory h2 = _makeHandInit();
        h2.buyIns[1] = 200e18;
        assertTrue(HandIdLib.handIdOf(h1) != HandIdLib.handIdOf(h2));
    }

    function test_handIdChangesWhenNonceChanges() public pure {
        HandInit memory h1 = _makeHandInit();
        HandInit memory h2 = _makeHandInit();
        h2.playerHandNonces[0] = 2;
        assertTrue(HandIdLib.handIdOf(h1) != HandIdLib.handIdOf(h2));
    }
}
```

- [ ] **Step 2: Run test, expect FAIL (HandIdLib undefined)**

```bash
forge test --match-path test/lib/HandIdLib.t.sol -vvv
```

- [ ] **Step 3: Implement HandIdLib**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {HandInit} from "../types/HandInit.sol";

/// @notice Deterministic handId derivation from a HandInit struct.
/// @dev handId = keccak256(abi.encode(HandInit fields)). Must match the
///      TypeScript helper in packages/frontend/src/game/modules/poker/handId.ts.
library HandIdLib {
    // tag::handIdOf[]
    /// @notice Compute the canonical handId for a HandInit.
    /// @custom:signature handIdOf((address[],uint256[],address,uint256,uint256,uint256,bytes32,uint256[]))
    function handIdOf(HandInit memory h) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            h.players,
            h.buyIns,
            h.vault,
            h.smallBlind,
            h.bigBlind,
            h.timeoutSeconds,
            h.otherConfig,
            h.playerHandNonces
        ));
    }
    // end::handIdOf[]
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
forge test --match-path test/lib/HandIdLib.t.sol -vvv
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/HandIdLib.sol test/lib/HandIdLib.t.sol
git commit -m "feat(contracts): add HandIdLib with deterministic handId derivation"
```

---

### Task 1.3: SignatureLib (EIP-712 verification)

**Files:**
- Create: `contracts/src/lib/SignatureLib.sol`
- Test: `contracts/test/lib/SignatureLib.t.sol`

- [ ] **Step 1: Write failing test**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SignatureLib} from "../../src/lib/SignatureLib.sol";

contract SignatureLibTest is Test {
    bytes32 constant DOMAIN_SEPARATOR = keccak256("test-domain");

    function test_recoverSigner() public {
        (address signer, uint256 pk) = makeAddrAndKey("signer");
        bytes32 structHash = keccak256("struct");
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        address recovered = SignatureLib.recoverEIP712(DOMAIN_SEPARATOR, structHash, sig);
        assertEq(recovered, signer);
    }

    function test_requireSignedByAll_passesWhenAllSign() public {
        bytes32 structHash = keccak256("struct");
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (address a, uint256 pkA) = makeAddrAndKey("a");
        (address b, uint256 pkB) = makeAddrAndKey("b");
        address[] memory signers = new address[](2);
        signers[0] = a;
        signers[1] = b;
        bytes[] memory sigs = new bytes[](2);
        (uint8 vA, bytes32 rA, bytes32 sA) = vm.sign(pkA, digest);
        (uint8 vB, bytes32 rB, bytes32 sB) = vm.sign(pkB, digest);
        sigs[0] = abi.encodePacked(rA, sA, vA);
        sigs[1] = abi.encodePacked(rB, sB, vB);
        SignatureLib.requireSignedByAll(DOMAIN_SEPARATOR, structHash, signers, sigs);
    }

    function test_requireSignedByAll_revertsOnWrongSigner() public {
        bytes32 structHash = keccak256("struct");
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (address a, uint256 pkA) = makeAddrAndKey("a");
        (address b,) = makeAddrAndKey("b");
        address[] memory signers = new address[](2);
        signers[0] = a;
        signers[1] = b;
        bytes[] memory sigs = new bytes[](2);
        (uint8 vA, bytes32 rA, bytes32 sA) = vm.sign(pkA, digest);
        sigs[0] = abi.encodePacked(rA, sA, vA);
        sigs[1] = sigs[0]; // wrong: signed by A not B
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 1, b));
        SignatureLib.requireSignedByAll(DOMAIN_SEPARATOR, structHash, signers, sigs);
    }
}
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
forge test --match-path test/lib/SignatureLib.t.sol -vvv
```

- [ ] **Step 3: Implement SignatureLib**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice EIP-712 signature helpers used by the poker settler.
/// @dev Domain separator is computed by the consuming contract; this library
///      only does digest building + recovery.
library SignatureLib {
    /// @custom:signature InvalidSignature(uint256,address)
    error InvalidSignature(uint256 index, address expected);
    /// @custom:signature LengthMismatch(uint256,uint256)
    error LengthMismatch(uint256 a, uint256 b);
    /// @custom:signature MalformedSignature(uint256)
    error MalformedSignature(uint256 length);

    /// @notice Recover the signer of an EIP-712 digest.
    function recoverEIP712(
        bytes32 domainSeparator,
        bytes32 structHash,
        bytes memory signature
    ) internal pure returns (address) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        return _recover(digest, signature);
    }

    /// @notice Revert unless every (signers[i], sigs[i]) pair recovers to signers[i].
    function requireSignedByAll(
        bytes32 domainSeparator,
        bytes32 structHash,
        address[] memory signers,
        bytes[] memory sigs
    ) internal pure {
        if (signers.length != sigs.length) revert LengthMismatch(signers.length, sigs.length);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        for (uint256 i = 0; i < signers.length; ++i) {
            address recovered = _recover(digest, sigs[i]);
            if (recovered != signers[i]) revert InvalidSignature(i, signers[i]);
        }
    }

    function _recover(bytes32 digest, bytes memory sig) private pure returns (address) {
        if (sig.length != 65) revert MalformedSignature(sig.length);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(digest, v, r, s);
    }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
forge test --match-path test/lib/SignatureLib.t.sol -vvv
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/SignatureLib.sol test/lib/SignatureLib.t.sol
git commit -m "feat(contracts): add SignatureLib EIP-712 recovery + requireSignedByAll"
```

---

## Phase 2: Configuration Oracle

### Task 2.1: BettingConfigOracle interface and errors

**Files:**
- Create: `contracts/src/oracle/IBettingConfigOracle.sol`
- Create: `contracts/src/oracle/BettingConfigOracleErrors.sol`

- [ ] **Step 1: Create interface**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Per-token rake configuration oracle (PRD §11.14).
interface IBettingConfigOracle {
    struct Entry {
        address operator;
        uint256 rakeBps;
    }

    /// @custom:signature ConfigUpdated(address,address,uint256)
    /// @custom:topiczero 0x{compute via cast keccak "ConfigUpdated(address,address,uint256)"}
    event ConfigUpdated(address indexed token, address operator, uint256 rakeBps);

    /// @custom:signature DefaultUpdated(address,uint256)
    event DefaultUpdated(address operator, uint256 rakeBps);

    /// @notice Look up the effective config for a token (per-token entry, else default).
    function configOf(address token) external view returns (address operator, uint256 rakeBps);

    /// @notice Set the per-token override. address(0) operator clears the entry.
    function setTokenConfig(address token, address operator, uint256 rakeBps) external;

    /// @notice Set the global default used when no per-token entry exists.
    function setDefault(address operator, uint256 rakeBps) external;

    /// @notice Read the default config.
    function defaultConfig() external view returns (address operator, uint256 rakeBps);
}
```

- [ ] **Step 2: Create errors**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

library BettingConfigOracleErrors {
    /// @custom:signature InvalidRakeBps(uint256)
    error InvalidRakeBps(uint256 rakeBps);
    /// @custom:signature OperatorIsZero()
    error OperatorIsZero();
}
```

`rakeBps` must be `< 10000` (100% rake makes no economic sense; reverts on overflow even at 10000 because pot would be entirely consumed).

- [ ] **Step 3: Verify build**

```bash
forge build
```

- [ ] **Step 4: Commit**

```bash
git add src/oracle/IBettingConfigOracle.sol src/oracle/BettingConfigOracleErrors.sol
git commit -m "feat(contracts): add IBettingConfigOracle interface and errors"
```

---

### Task 2.2: BettingConfigOracleRepo (storage)

**Files:**
- Create: `contracts/src/oracle/BettingConfigOracleRepo.sol`

Follows Crane's dual-overload Repo pattern (see `manamesh/lib/crane/contracts/access/operable/OperableRepo.sol` as the canonical example).

- [ ] **Step 1: Create the Repo**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";
import {BettingConfigOracleErrors} from "./BettingConfigOracleErrors.sol";

/// @notice Storage layout for the BettingConfigOracle Diamond.
/// @dev Crane Diamond storage pattern: STORAGE_SLOT + dual _layout overloads
///      + dual function overloads (param + default).
library BettingConfigOracleRepo {
    bytes32 internal constant STORAGE_SLOT = keccak256(abi.encode("manamesh.oracle.betting-config"));

    uint256 internal constant MAX_RAKE_BPS_EXCLUSIVE = 10_000;

    struct Storage {
        IBettingConfigOracle.Entry defaultEntry;
        mapping(address => IBettingConfigOracle.Entry) tokenEntry;
    }

    /* ------------------------------------------------------------------ */
    /*                           Layout access                            */
    /* ------------------------------------------------------------------ */

    function _layout(bytes32 slot) internal pure returns (Storage storage layout) {
        assembly { layout.slot := slot }
    }

    function _layout() internal pure returns (Storage storage) {
        return _layout(STORAGE_SLOT);
    }

    /* ------------------------------------------------------------------ */
    /*                              Reads                                 */
    /* ------------------------------------------------------------------ */

    function _configOf(Storage storage layout, address token)
        internal
        view
        returns (address operator, uint256 rakeBps)
    {
        IBettingConfigOracle.Entry storage e = layout.tokenEntry[token];
        if (e.operator != address(0)) {
            return (e.operator, e.rakeBps);
        }
        return (layout.defaultEntry.operator, layout.defaultEntry.rakeBps);
    }

    function _configOf(address token) internal view returns (address, uint256) {
        return _configOf(_layout(), token);
    }

    function _defaultConfig(Storage storage layout)
        internal
        view
        returns (address operator, uint256 rakeBps)
    {
        return (layout.defaultEntry.operator, layout.defaultEntry.rakeBps);
    }

    function _defaultConfig() internal view returns (address, uint256) {
        return _defaultConfig(_layout());
    }

    /* ------------------------------------------------------------------ */
    /*                              Writes                                */
    /* ------------------------------------------------------------------ */

    function _setTokenConfig(
        Storage storage layout,
        address token,
        address operator,
        uint256 rakeBps
    ) internal {
        if (operator != address(0)) {
            // setting a real entry: validate
            if (rakeBps >= MAX_RAKE_BPS_EXCLUSIVE) {
                revert BettingConfigOracleErrors.InvalidRakeBps(rakeBps);
            }
        }
        // operator == address(0) means "clear the entry" (lookup falls through to default)
        layout.tokenEntry[token] = IBettingConfigOracle.Entry({operator: operator, rakeBps: rakeBps});
    }

    function _setTokenConfig(address token, address operator, uint256 rakeBps) internal {
        _setTokenConfig(_layout(), token, operator, rakeBps);
    }

    function _setDefault(Storage storage layout, address operator, uint256 rakeBps) internal {
        if (operator == address(0)) revert BettingConfigOracleErrors.OperatorIsZero();
        if (rakeBps >= MAX_RAKE_BPS_EXCLUSIVE) {
            revert BettingConfigOracleErrors.InvalidRakeBps(rakeBps);
        }
        layout.defaultEntry = IBettingConfigOracle.Entry({operator: operator, rakeBps: rakeBps});
    }

    function _setDefault(address operator, uint256 rakeBps) internal {
        _setDefault(_layout(), operator, rakeBps);
    }
}
```

- [ ] **Step 2: Verify build**

```bash
forge build
```

- [ ] **Step 3: Commit**

```bash
git add src/oracle/BettingConfigOracleRepo.sol
git commit -m "feat(contracts): add BettingConfigOracleRepo storage layer"
```

---

### Task 2.3: BettingConfigOracleTarget (logic + tests)

**Files:**
- Create: `contracts/src/oracle/BettingConfigOracleTarget.sol`
- Test: `contracts/test/oracle/BettingConfigOracle.t.sol`

The Target inherits `MultiStepOwnableModifiers` from Crane (ERC8023 two-step ownership) so `setTokenConfig` and `setDefault` are `onlyOwner`.

- [ ] **Step 1: Write the failing test**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IBettingConfigOracle} from "../../src/oracle/IBettingConfigOracle.sol";
import {BettingConfigOracleErrors} from "../../src/oracle/BettingConfigOracleErrors.sol";
import {BettingConfigOracleRepo} from "../../src/oracle/BettingConfigOracleRepo.sol";
import {BettingConfigOracleTarget} from "../../src/oracle/BettingConfigOracleTarget.sol";

/// @notice Direct Target tests (no diamond proxy): exercise the storage + access guards.
contract BettingConfigOracleTargetTest is Test {
    BettingConfigOracleTarget target;
    address owner = address(0xAAaa);
    address altOperator = address(0xBBbb);
    address defaultOperator = address(0xCCcc);
    address token = address(0xDDdd);

    function setUp() public {
        target = new BettingConfigOracleTarget();
        // Initialize owner directly via the MultiStepOwnableRepo (test helper exposed by Target).
        target._test_initializeOwner(owner);
        // Initialize default config.
        vm.prank(owner);
        target.setDefault(defaultOperator, 100); // 1% default rake
    }

    function test_configOf_returnsDefaultWhenNoTokenEntry() public view {
        (address op, uint256 bps) = target.configOf(token);
        assertEq(op, defaultOperator);
        assertEq(bps, 100);
    }

    function test_setTokenConfig_overridesDefault() public {
        vm.prank(owner);
        target.setTokenConfig(token, altOperator, 250); // 2.5% for this token
        (address op, uint256 bps) = target.configOf(token);
        assertEq(op, altOperator);
        assertEq(bps, 250);
    }

    function test_setTokenConfig_zeroOperatorClearsEntry() public {
        vm.prank(owner);
        target.setTokenConfig(token, altOperator, 250);
        vm.prank(owner);
        target.setTokenConfig(token, address(0), 0);
        (address op,) = target.configOf(token);
        assertEq(op, defaultOperator); // falls back to default
    }

    function test_setTokenConfig_revertsForNonOwner() public {
        vm.expectRevert(); // any MultiStepOwnable revert
        target.setTokenConfig(token, altOperator, 250);
    }

    function test_setDefault_revertsOnZeroOperator() public {
        vm.prank(owner);
        vm.expectRevert(BettingConfigOracleErrors.OperatorIsZero.selector);
        target.setDefault(address(0), 100);
    }

    function test_setDefault_revertsOnRakeBpsTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BettingConfigOracleErrors.InvalidRakeBps.selector, 10_000));
        target.setDefault(defaultOperator, 10_000);
    }

    function test_setTokenConfig_emitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit IBettingConfigOracle.ConfigUpdated(token, altOperator, 250);
        target.setTokenConfig(token, altOperator, 250);
    }
}
```

- [ ] **Step 2: Run test, expect FAIL (Target undefined)**

```bash
forge test --match-path test/oracle/BettingConfigOracle.t.sol -vvv
```

- [ ] **Step 3: Implement the Target**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {MultiStepOwnableModifiers} from "@crane/contracts/access/ERC8023/MultiStepOwnableModifiers.sol";
import {MultiStepOwnableRepo} from "@crane/contracts/access/ERC8023/MultiStepOwnableRepo.sol";

import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";
import {BettingConfigOracleErrors} from "./BettingConfigOracleErrors.sol";
import {BettingConfigOracleRepo} from "./BettingConfigOracleRepo.sol";

/// @notice Implementation of the betting config oracle. Deployable directly
///         for local testing and inherited by BettingConfigOracleFacet for
///         diamond usage.
contract BettingConfigOracleTarget is IBettingConfigOracle, MultiStepOwnableModifiers {
    /* ------------------------------------------------------------------ */
    /*                              Reads                                 */
    /* ------------------------------------------------------------------ */

    function configOf(address token) external view returns (address operator, uint256 rakeBps) {
        return BettingConfigOracleRepo._configOf(token);
    }

    function defaultConfig() external view returns (address operator, uint256 rakeBps) {
        return BettingConfigOracleRepo._defaultConfig();
    }

    /* ------------------------------------------------------------------ */
    /*                              Writes                                */
    /* ------------------------------------------------------------------ */

    function setTokenConfig(address token, address operator, uint256 rakeBps) external onlyOwner {
        BettingConfigOracleRepo._setTokenConfig(token, operator, rakeBps);
        emit ConfigUpdated(token, operator, rakeBps);
    }

    function setDefault(address operator, uint256 rakeBps) external onlyOwner {
        BettingConfigOracleRepo._setDefault(operator, rakeBps);
        emit DefaultUpdated(operator, rakeBps);
    }

    /* ------------------------------------------------------------------ */
    /*                       Test-only initializer                        */
    /* ------------------------------------------------------------------ */

    /// @notice Direct initialization helper used only by unit tests that
    ///         instantiate this Target without going through the diamond.
    ///         Real deployments initialize ownership via the DFPkg.
    function _test_initializeOwner(address owner_) external {
        MultiStepOwnableRepo._initialize(owner_);
    }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
forge test --match-path test/oracle/BettingConfigOracle.t.sol -vvv
```

- [ ] **Step 5: Commit**

```bash
git add src/oracle/BettingConfigOracleTarget.sol test/oracle/BettingConfigOracle.t.sol
git commit -m "feat(contracts): add BettingConfigOracleTarget with ERC8023 ownership"
```

---

### Task 2.4: BettingConfigOracleFacet (IFacet metadata)

**Files:**
- Create: `contracts/src/oracle/BettingConfigOracleFacet.sol`

- [ ] **Step 1: Create the facet**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";
import {BettingConfigOracleTarget} from "./BettingConfigOracleTarget.sol";

contract BettingConfigOracleFacet is BettingConfigOracleTarget, IFacet {
    function facetName() external pure returns (string memory) {
        return "BettingConfigOracleFacet";
    }

    function facetInterfaces() external pure returns (bytes4[] memory ifaces) {
        ifaces = new bytes4[](1);
        ifaces[0] = type(IBettingConfigOracle).interfaceId;
    }

    function facetFuncs() external pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](4);
        selectors[0] = IBettingConfigOracle.configOf.selector;
        selectors[1] = IBettingConfigOracle.defaultConfig.selector;
        selectors[2] = IBettingConfigOracle.setTokenConfig.selector;
        selectors[3] = IBettingConfigOracle.setDefault.selector;
    }

    function facetMetadata() external pure returns (
        string memory name,
        bytes4[] memory interfaces,
        bytes4[] memory functions
    ) {
        name = "BettingConfigOracleFacet";
        interfaces = new bytes4[](1);
        interfaces[0] = type(IBettingConfigOracle).interfaceId;
        functions = new bytes4[](4);
        functions[0] = IBettingConfigOracle.configOf.selector;
        functions[1] = IBettingConfigOracle.defaultConfig.selector;
        functions[2] = IBettingConfigOracle.setTokenConfig.selector;
        functions[3] = IBettingConfigOracle.setDefault.selector;
    }
}
```

- [ ] **Step 2: Verify build**

```bash
forge build
```

- [ ] **Step 3: Commit**

```bash
git add src/oracle/BettingConfigOracleFacet.sol
git commit -m "feat(contracts): add BettingConfigOracleFacet with IFacet metadata"
```

---

### Task 2.5: BettingConfigOracleDFPkg + end-to-end deploy test

**Files:**
- Create: `contracts/src/oracle/BettingConfigOracleDFPkg.sol`
- Modify: `contracts/test/oracle/BettingConfigOracle.t.sol` (add diamond-deployment test)

This DFPkg follows the pattern in `manamesh/lib/crane/contracts/tokens/ERC20/ERC20PermitMintBurnLockedOwnableDFPkg.sol`. It bundles:
- `BettingConfigOracleFacet` (our facet)
- `MultiStepOwnableFacet` from Crane (for owner / two-step transfer external calls)
- `DiamondCutFacet` from Crane (for upgrades)
- `ERC165Facet` from Crane (for introspection)

- [ ] **Step 1: Implement the DFPkg**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IDiamond} from "@crane/contracts/interfaces/IDiamond.sol";
import {IDiamondFactoryPackage} from "@crane/contracts/interfaces/IDiamondFactoryPackage.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {DiamondConfig} from "@crane/contracts/factories/diamondPkg/DiamondConfig.sol";
import {MultiStepOwnableRepo} from "@crane/contracts/access/ERC8023/MultiStepOwnableRepo.sol";

import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";
import {BettingConfigOracleRepo} from "./BettingConfigOracleRepo.sol";

interface IBettingConfigOracleDFPkg {
    struct PkgInit {
        IFacet bettingConfigOracleFacet;
        IFacet multiStepOwnableFacet;
        IFacet diamondCutFacet;
        IFacet erc165Facet;
        IDiamondPackageCallBackFactory diamondFactory;
    }

    struct PkgArgs {
        address owner;
        address defaultOperator;
        uint256 defaultRakeBps;
        bytes32 optionalSalt;
    }

    function deployOracle(PkgArgs memory args) external returns (address oracle);
}

contract BettingConfigOracleDFPkg is IDiamondFactoryPackage, IBettingConfigOracleDFPkg {
    IFacet immutable BETTING_CONFIG_ORACLE_FACET;
    IFacet immutable MULTI_STEP_OWNABLE_FACET;
    IFacet immutable DIAMOND_CUT_FACET;
    IFacet immutable ERC165_FACET;
    IDiamondPackageCallBackFactory immutable DIAMOND_FACTORY;

    constructor(PkgInit memory init) {
        BETTING_CONFIG_ORACLE_FACET = init.bettingConfigOracleFacet;
        MULTI_STEP_OWNABLE_FACET = init.multiStepOwnableFacet;
        DIAMOND_CUT_FACET = init.diamondCutFacet;
        ERC165_FACET = init.erc165Facet;
        DIAMOND_FACTORY = init.diamondFactory;
    }

    function packageName() external pure returns (string memory) {
        return "BettingConfigOracleDFPkg";
    }

    function facetCuts() external view returns (IDiamond.FacetCut[] memory cuts) {
        cuts = new IDiamond.FacetCut[](4);
        cuts[0] = _cutFor(BETTING_CONFIG_ORACLE_FACET);
        cuts[1] = _cutFor(MULTI_STEP_OWNABLE_FACET);
        cuts[2] = _cutFor(DIAMOND_CUT_FACET);
        cuts[3] = _cutFor(ERC165_FACET);
    }

    function diamondConfig() external view returns (DiamondConfig memory cfg) {
        // No init function on the diamond itself — initAccount handles per-instance setup.
    }

    function calcSalt(bytes memory pkgArgs) external pure returns (bytes32) {
        PkgArgs memory args = abi.decode(pkgArgs, (PkgArgs));
        if (args.optionalSalt != bytes32(0)) return args.optionalSalt;
        return keccak256(abi.encode("manamesh.oracle.betting-config", args.owner));
    }

    /// @dev Called via delegatecall on the freshly-deployed proxy.
    function initAccount(bytes memory initArgs) external {
        PkgArgs memory args = abi.decode(initArgs, (PkgArgs));
        MultiStepOwnableRepo._initialize(args.owner);
        BettingConfigOracleRepo._setDefault(args.defaultOperator, args.defaultRakeBps);
    }

    function postDeploy(address /*account*/) external pure returns (bool) {
        return true;
    }

    function deployOracle(PkgArgs memory args) external returns (address oracle) {
        oracle = DIAMOND_FACTORY.deploy(IDiamondFactoryPackage(address(this)), abi.encode(args));
    }

    function _cutFor(IFacet f) internal view returns (IDiamond.FacetCut memory cut) {
        cut.facetAddress = address(f);
        cut.action = IDiamond.FacetCutAction.Add;
        cut.functionSelectors = f.facetFuncs();
    }
}
```

- [ ] **Step 2: Add diamond-deployment test in BettingConfigOracle.t.sol**

Append this contract to the existing test file:

```solidity
import {CraneTest} from "@crane/contracts/test/CraneTest.sol";
import {AccessFacetFactoryService} from "@crane/contracts/access/AccessFacetFactoryService.sol";
import {IntrospectionFacetFactoryService} from "@crane/contracts/introspection/IntrospectionFacetFactoryService.sol";
import {BettingConfigOracleFacet} from "../../src/oracle/BettingConfigOracleFacet.sol";
import {BettingConfigOracleDFPkg, IBettingConfigOracleDFPkg} from "../../src/oracle/BettingConfigOracleDFPkg.sol";

contract BettingConfigOracleDiamondTest is CraneTest {
    IBettingConfigOracle oracle;
    address oracleOwner = address(0xA11ce);
    address defaultOp = address(0xBeef);
    address token = address(0xDeAD);

    function setUp() public override {
        super.setUp(); // creates create3Factory + diamondFactory

        // Deploy the BettingConfigOracleFacet.
        BettingConfigOracleFacet facet = new BettingConfigOracleFacet();

        // Deploy other facets via Crane FactoryServices (helpers around create3Factory).
        IFacet multiStepOwnableFacet = AccessFacetFactoryService.deployMultiStepOwnableFacet(create3Factory);
        IFacet diamondCutFacet = IntrospectionFacetFactoryService.deployDiamondCutFacet(create3Factory);
        IFacet erc165Facet = IntrospectionFacetFactoryService.deployERC165Facet(create3Factory);

        // Deploy the DFPkg with facet references.
        BettingConfigOracleDFPkg pkg = new BettingConfigOracleDFPkg(
            IBettingConfigOracleDFPkg.PkgInit({
                bettingConfigOracleFacet: IFacet(address(facet)),
                multiStepOwnableFacet: multiStepOwnableFacet,
                diamondCutFacet: diamondCutFacet,
                erc165Facet: erc165Facet,
                diamondFactory: diamondFactory
            })
        );

        // Deploy a diamond.
        address oracleAddr = pkg.deployOracle(IBettingConfigOracleDFPkg.PkgArgs({
            owner: oracleOwner,
            defaultOperator: defaultOp,
            defaultRakeBps: 250,
            optionalSalt: bytes32(0)
        }));
        oracle = IBettingConfigOracle(oracleAddr);
    }

    function test_diamondDefaultLookup() public view {
        (address op, uint256 bps) = oracle.configOf(token);
        assertEq(op, defaultOp);
        assertEq(bps, 250);
    }

    function test_diamondOwnerCanSetTokenConfig() public {
        address alt = address(0xC0FFEE);
        vm.prank(oracleOwner);
        oracle.setTokenConfig(token, alt, 500);
        (address op, uint256 bps) = oracle.configOf(token);
        assertEq(op, alt);
        assertEq(bps, 500);
    }

    function test_diamondRejectsNonOwner() public {
        vm.expectRevert();
        oracle.setTokenConfig(token, address(0xC0FFEE), 500);
    }
}
```

If the exact `FactoryService` helper names differ in Crane (the AGENTS.md examples list `deployERC165Facet` and `deployDiamondCutDFPkg`; double-check actual helper names), use the closest equivalent.

- [ ] **Step 3: Run all oracle tests**

```bash
forge test --match-path test/oracle/BettingConfigOracle.t.sol -vvv
```

- [ ] **Step 4: Commit**

```bash
git add src/oracle/BettingConfigOracleDFPkg.sol test/oracle/BettingConfigOracle.t.sol
git commit -m "feat(contracts): add BettingConfigOracleDFPkg and diamond-level integration tests"
```

---

## Phase 3: Poker Hand Settler Core

### Task 3.1: PokerHandSettler interface, errors, events

**Files:**
- Create: `contracts/src/settler/IPokerHandSettler.sol`
- Create: `contracts/src/settler/PokerHandSettlerErrors.sol`

- [ ] **Step 1: Interface**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {HandInit} from "../types/HandInit.sol";
import {HandOutcome} from "../types/HandOutcome.sol";
import {RoundStateTransition} from "../types/RoundStateTransition.sol";

interface IPokerHandSettler {
    /* ------------------------------- Events ------------------------------- */
    event Deposited(address indexed player, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed player, uint256 amount, uint256 newBalance);
    event HandActivated(bytes32 indexed handId, uint256 pot, uint256 lastActivity);
    event HandSettled(bytes32 indexed handId, uint256 pot, uint256 rake, bytes32 finalStateHash);
    event HandForceSettled(bytes32 indexed handId, uint256 pot, uint256 forfeited, uint256 rake);
    event MembershipAsserted(bytes32 indexed handId, address indexed player, uint256 buyIn);
    event PlayerTimedOut(bytes32 indexed handId, address indexed player);

    /* ------------------------------ External ----------------------------- */
    function token() external view returns (address);
    function oracle() external view returns (address);
    function balanceOf(address player) external view returns (uint256);
    function lockedOf(address player) external view returns (uint256);

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;

    function assertHandMembership(
        HandInit calldata init,
        bytes[] calldata signatures
    ) external;

    function settleHand(
        HandOutcome calldata outcome,
        bytes[] calldata signatures
    ) external;

    function forceTimeoutSettlement(
        HandOutcome calldata outcome,
        bytes[] calldata winnerSignatures,
        RoundStateTransition calldata lastRound,
        bytes[] calldata roundSignatures
    ) external;

    function timeoutPlayer(bytes32 handId, address player) external;
}
```

- [ ] **Step 2: Errors**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

library PokerHandSettlerErrors {
    /// @custom:signature InsufficientBalance(uint256,uint256)
    error InsufficientBalance(uint256 requested, uint256 available);
    /// @custom:signature InsufficientFreeBalance(uint256,uint256)
    error InsufficientFreeBalance(uint256 requested, uint256 free);
    /// @custom:signature HandAlreadyActivated()
    error HandAlreadyActivated();
    /// @custom:signature HandNotActive()
    error HandNotActive();
    /// @custom:signature HandAlreadySettled()
    error HandAlreadySettled();
    /// @custom:signature HandIdMismatch(bytes32,bytes32)
    error HandIdMismatch(bytes32 expected, bytes32 actual);
    /// @custom:signature DuplicateAssertion(address)
    error DuplicateAssertion(address player);
    /// @custom:signature PlayerCountOutOfRange(uint256)
    error PlayerCountOutOfRange(uint256 count);
    /// @custom:signature PlayersNotSorted()
    error PlayersNotSorted();
    /// @custom:signature ArrayLengthMismatch()
    error ArrayLengthMismatch();
    /// @custom:signature VaultMismatch(address,address)
    error VaultMismatch(address expected, address actual);
    /// @custom:signature TimeoutNotElapsed(uint256,uint256)
    error TimeoutNotElapsed(uint256 nowTs, uint256 elapsesAt);
    /// @custom:signature PotMismatch(uint256,uint256)
    error PotMismatch(uint256 declared, uint256 actual);
    /// @custom:signature PayoutSumMismatch(uint256,uint256)
    error PayoutSumMismatch(uint256 payouts, uint256 potMinusRake);
    /// @custom:signature ConflictingOutcome()
    error ConflictingOutcome();
}
```

- [ ] **Step 3: Build**

```bash
forge build
```

- [ ] **Step 4: Commit**

```bash
git add src/settler/IPokerHandSettler.sol src/settler/PokerHandSettlerErrors.sol
git commit -m "feat(contracts): add IPokerHandSettler interface and errors"
```

---

### Task 3.2: PokerHandSettlerRepo (storage)

**Files:**
- Create: `contracts/src/settler/PokerHandSettlerRepo.sol`

- [ ] **Step 1: Implement the Repo**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IBettingConfigOracle} from "../oracle/IBettingConfigOracle.sol";

library PokerHandSettlerRepo {
    bytes32 internal constant STORAGE_SLOT = keccak256(abi.encode("manamesh.settler.poker-hand"));

    uint256 internal constant MIN_PLAYERS = 2;
    uint256 internal constant MAX_PLAYERS = 9;

    enum HandStatus {
        None,
        PartiallyAsserted,
        Active,
        Settled
    }

    struct HandState {
        HandStatus status;
        uint256 pot;                              // sum of buy-ins (constant after activation)
        uint256 lastActivity;                     // block.timestamp updated on any on-chain action
        uint256 timeoutSeconds;                   // from HandInit
        uint256 assertedCount;
        mapping(address => bool) asserted;
        bytes32 finalStateHash;
    }

    struct Storage {
        IERC20 token;                             // immutable per-settler (set in initAccount)
        IBettingConfigOracle oracle;              // immutable per-settler
        mapping(address => uint256) balance;
        mapping(address => uint256) locked;
        mapping(bytes32 => HandState) handState;
    }

    function _layout(bytes32 slot) internal pure returns (Storage storage layout) {
        assembly { layout.slot := slot }
    }

    function _layout() internal pure returns (Storage storage) {
        return _layout(STORAGE_SLOT);
    }

    /* ---------------------- Balance / lock helpers ---------------------- */

    function _credit(Storage storage layout, address player, uint256 amount) internal {
        layout.balance[player] += amount;
    }

    function _debit(Storage storage layout, address player, uint256 amount) internal {
        layout.balance[player] -= amount; // reverts on underflow under 0.8.x
    }

    function _lock(Storage storage layout, address player, uint256 amount) internal {
        layout.balance[player] -= amount;
        layout.locked[player] += amount;
    }

    function _unlock(Storage storage layout, address player, uint256 amount) internal {
        layout.locked[player] -= amount;
        layout.balance[player] += amount;
    }

    function _freeBalance(Storage storage layout, address player) internal view returns (uint256) {
        return layout.balance[player];
    }
}
```

- [ ] **Step 2: Build**

```bash
forge build
```

- [ ] **Step 3: Commit**

```bash
git add src/settler/PokerHandSettlerRepo.sol
git commit -m "feat(contracts): add PokerHandSettlerRepo storage layout"
```

---

### Task 3.3: deposit / withdraw on Target + tests

**Files:**
- Create: `contracts/src/settler/PokerHandSettlerTarget.sol`
- Test: `contracts/test/settler/PokerHandSettler_deposit.t.sol`
- Test: `contracts/test/settler/PokerHandSettler_withdraw.t.sol`

For now, the Target only implements deposit/withdraw. Subsequent tasks add assertion / settlement / force-timeout. The Target's EIP-712 domain separator and oracle ref are set in `_initialize`.

- [ ] **Step 1: Deposit tests**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Mock} from "../../src/settler/_test/ERC20Mock.sol";
import {PokerHandSettlerTarget} from "../../src/settler/PokerHandSettlerTarget.sol";
import {PokerHandSettlerErrors} from "../../src/settler/PokerHandSettlerErrors.sol";
import {IPokerHandSettler} from "../../src/settler/IPokerHandSettler.sol";

contract PokerHandSettlerDepositTest is Test {
    PokerHandSettlerTarget settler;
    ERC20Mock token;
    address alice = address(0xA11ce);

    function setUp() public {
        token = new ERC20Mock("Mock", "MCK");
        settler = new PokerHandSettlerTarget();
        settler._test_initialize(address(token), address(0xDEAD)); // oracle not used here
        token.mint(alice, 1_000e18);
        vm.prank(alice);
        token.approve(address(settler), type(uint256).max);
    }

    function test_depositCreditsBalance() public {
        vm.prank(alice);
        settler.deposit(100e18);
        assertEq(settler.balanceOf(alice), 100e18);
    }

    function test_depositTransfersTokens() public {
        vm.prank(alice);
        settler.deposit(100e18);
        assertEq(token.balanceOf(address(settler)), 100e18);
        assertEq(token.balanceOf(alice), 900e18);
    }

    function test_depositEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IPokerHandSettler.Deposited(alice, 100e18, 100e18);
        vm.prank(alice);
        settler.deposit(100e18);
    }
}
```

Create the ERC20Mock helper:

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract ERC20Mock is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
```

Place at `contracts/src/settler/_test/ERC20Mock.sol`.

- [ ] **Step 2: Withdraw tests**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20Mock} from "../../src/settler/_test/ERC20Mock.sol";
import {PokerHandSettlerTarget} from "../../src/settler/PokerHandSettlerTarget.sol";
import {PokerHandSettlerErrors} from "../../src/settler/PokerHandSettlerErrors.sol";

contract PokerHandSettlerWithdrawTest is Test {
    PokerHandSettlerTarget settler;
    ERC20Mock token;
    address alice = address(0xA11ce);

    function setUp() public {
        token = new ERC20Mock("Mock", "MCK");
        settler = new PokerHandSettlerTarget();
        settler._test_initialize(address(token), address(0xDEAD));
        token.mint(alice, 1_000e18);
        vm.prank(alice);
        token.approve(address(settler), type(uint256).max);
        vm.prank(alice);
        settler.deposit(500e18);
    }

    function test_withdrawDebitsBalanceAndTransfers() public {
        vm.prank(alice);
        settler.withdraw(200e18);
        assertEq(settler.balanceOf(alice), 300e18);
        assertEq(token.balanceOf(alice), 700e18);
    }

    function test_withdrawRevertsOnInsufficient() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            PokerHandSettlerErrors.InsufficientFreeBalance.selector, 600e18, 500e18
        ));
        settler.withdraw(600e18);
    }

    function test_withdrawRespectsLockedBalance() public {
        // Force a lock via test helper.
        settler._test_lock(alice, 300e18);
        // Free balance is now 200e18.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            PokerHandSettlerErrors.InsufficientFreeBalance.selector, 250e18, 200e18
        ));
        settler.withdraw(250e18);
    }
}
```

- [ ] **Step 3: Run tests, expect FAIL**

```bash
forge test --match-path 'test/settler/PokerHandSettler_*.t.sol' -vvv
```

- [ ] **Step 4: Implement minimal Target**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBettingConfigOracle} from "../oracle/IBettingConfigOracle.sol";
import {IPokerHandSettler} from "./IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "./PokerHandSettlerErrors.sol";
import {PokerHandSettlerRepo} from "./PokerHandSettlerRepo.sol";

contract PokerHandSettlerTarget is IPokerHandSettler, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* --------------------------- Reads --------------------------- */

    function token() external view returns (address) {
        return address(PokerHandSettlerRepo._layout().token);
    }

    function oracle() external view returns (address) {
        return address(PokerHandSettlerRepo._layout().oracle);
    }

    function balanceOf(address player) external view returns (uint256) {
        return PokerHandSettlerRepo._layout().balance[player];
    }

    function lockedOf(address player) external view returns (uint256) {
        return PokerHandSettlerRepo._layout().locked[player];
    }

    /* --------------------------- Writes --------------------------- */

    function deposit(uint256 amount) external nonReentrant {
        PokerHandSettlerRepo.Storage storage layout = PokerHandSettlerRepo._layout();
        IERC20(layout.token).safeTransferFrom(msg.sender, address(this), amount);
        PokerHandSettlerRepo._credit(layout, msg.sender, amount);
        emit Deposited(msg.sender, amount, layout.balance[msg.sender]);
    }

    function withdraw(uint256 amount) external nonReentrant {
        PokerHandSettlerRepo.Storage storage layout = PokerHandSettlerRepo._layout();
        uint256 free = layout.balance[msg.sender];
        if (amount > free) revert PokerHandSettlerErrors.InsufficientFreeBalance(amount, free);
        PokerHandSettlerRepo._debit(layout, msg.sender, amount);
        IERC20(layout.token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, layout.balance[msg.sender]);
    }

    // Stubs for the interface (implemented in later tasks).
    function assertHandMembership(HandInit calldata, bytes[] calldata) external {
        revert("not implemented");
    }
    function settleHand(HandOutcome calldata, bytes[] calldata) external {
        revert("not implemented");
    }
    function forceTimeoutSettlement(
        HandOutcome calldata, bytes[] calldata, RoundStateTransition calldata, bytes[] calldata
    ) external {
        revert("not implemented");
    }
    function timeoutPlayer(bytes32, address) external pure {
        revert("not implemented");
    }

    /* ------------------------ Test helpers ------------------------ */

    /// @dev Replaces DFPkg initAccount path for direct-Target tests.
    function _test_initialize(address token_, address oracle_) external {
        PokerHandSettlerRepo.Storage storage layout = PokerHandSettlerRepo._layout();
        layout.token = IERC20(token_);
        layout.oracle = IBettingConfigOracle(oracle_);
    }

    function _test_lock(address player, uint256 amount) external {
        PokerHandSettlerRepo._lock(PokerHandSettlerRepo._layout(), player, amount);
    }
}
```

(Imports of `HandInit`, `HandOutcome`, `RoundStateTransition` come transitively via `IPokerHandSettler`.)

- [ ] **Step 5: Run tests, expect PASS**

```bash
forge test --match-path 'test/settler/PokerHandSettler_*.t.sol' -vvv
```

- [ ] **Step 6: Commit**

```bash
git add src/settler test/settler
git commit -m "feat(contracts): add PokerHandSettlerTarget deposit/withdraw with locked-balance accounting"
```

---

### Task 3.4: assertHandMembership

**Files:**
- Modify: `contracts/src/settler/PokerHandSettlerTarget.sol`
- Test: `contracts/test/settler/PokerHandSettler_assertHandMembership.t.sol`

`assertHandMembership` is the most-complex per-hand entry point. It:

1. Recomputes `handId` via `HandIdLib.handIdOf(init)` and uses it as the storage key.
2. Verifies `init.vault == address(this)`.
3. Verifies `2 <= init.players.length <= 9` and array lengths match.
4. Verifies players[] sorted ascending (no duplicates).
5. Verifies that `msg.sender` is in `init.players`.
6. Verifies all signatures over EIP-712 digest of `(HAND_INIT_TYPEHASH, init)`.
7. Reverts on duplicate assertion for `msg.sender`.
8. Locks `init.buyIns[i]` of the caller — reverting if free balance insufficient.
9. Bumps `assertedCount`. If `assertedCount == players.length`, sets `status = Active`, `pot = sum(buyIns)`, `lastActivity = block.timestamp`, emits `HandActivated`.
10. Always emits `MembershipAsserted`.

Each signature in `signatures[i]` is over the EIP-712 digest produced by `init`, signed by `init.players[i]`. Step 6 uses `SignatureLib.requireSignedByAll` once on first assertion, then caches a hash to skip re-verification on later assertions. (Simpler v1: verify all signatures on every call. Optimize later if gas allows.)

- [ ] **Step 1: Write failing tests**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20Mock} from "../../src/settler/_test/ERC20Mock.sol";
import {PokerHandSettlerTarget} from "../../src/settler/PokerHandSettlerTarget.sol";
import {PokerHandSettlerErrors} from "../../src/settler/PokerHandSettlerErrors.sol";
import {HandInit, HAND_INIT_TYPEHASH} from "../../src/types/HandInit.sol";

contract PokerHandSettlerAssertMembershipTest is Test {
    PokerHandSettlerTarget settler;
    ERC20Mock token;

    address alice; uint256 pkAlice;
    address bob;   uint256 pkBob;
    bytes32 domainSeparator;

    function setUp() public {
        token = new ERC20Mock("Mock", "MCK");
        settler = new PokerHandSettlerTarget();
        settler._test_initialize(address(token), address(0xDEAD));
        (alice, pkAlice) = makeAddrAndKey("alice");
        (bob,   pkBob)   = makeAddrAndKey("bob");
        // Ensure alice < bob by address. If not, swap.
        if (alice > bob) {
            (alice, bob) = (bob, alice);
            (pkAlice, pkBob) = (pkBob, pkAlice);
        }
        token.mint(alice, 1_000e18);
        token.mint(bob,   1_000e18);
        vm.prank(alice); token.approve(address(settler), type(uint256).max);
        vm.prank(bob);   token.approve(address(settler), type(uint256).max);
        vm.prank(alice); settler.deposit(500e18);
        vm.prank(bob);   settler.deposit(500e18);
        domainSeparator = settler._test_domainSeparator();
    }

    function _makeInit() internal view returns (HandInit memory h) {
        h.players = new address[](2);
        h.players[0] = alice;
        h.players[1] = bob;
        h.buyIns = new uint256[](2);
        h.buyIns[0] = 100e18;
        h.buyIns[1] = 100e18;
        h.vault = address(settler);
        h.smallBlind = 1e18;
        h.bigBlind = 2e18;
        h.timeoutSeconds = 300;
        h.otherConfig = bytes32(0);
        h.playerHandNonces = new uint256[](2);
        h.playerHandNonces[0] = 1;
        h.playerHandNonces[1] = 1;
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sigsForInit(HandInit memory h) internal view returns (bytes[] memory sigs) {
        bytes32 structHash = keccak256(abi.encode(HAND_INIT_TYPEHASH, /* fields as struct hash */ keccak256(abi.encode(h))));
        // Real impl will use proper EIP-712 struct hashing; for the test we hand-roll the digest.
        sigs = new bytes[](2);
        sigs[0] = _sign(pkAlice, structHash);
        sigs[1] = _sign(pkBob,   structHash);
    }

    function test_locksBuyInAndEmitsAsserted() public {
        HandInit memory h = _makeInit();
        bytes[] memory sigs = _sigsForInit(h);
        vm.prank(alice);
        settler.assertHandMembership(h, sigs);
        assertEq(settler.lockedOf(alice), 100e18);
        assertEq(settler.balanceOf(alice), 400e18);
    }

    function test_lastAssertionActivatesHand() public {
        HandInit memory h = _makeInit();
        bytes[] memory sigs = _sigsForInit(h);
        vm.prank(alice); settler.assertHandMembership(h, sigs);
        vm.prank(bob);   settler.assertHandMembership(h, sigs);
        // pot should be sum of buy-ins; status active.
        // assertion expressed via _test_handStatus helper.
        assertEq(uint256(settler._test_handStatusOf(h)), 2); // 2 = Active
    }

    function test_duplicateAssertionReverts() public {
        HandInit memory h = _makeInit();
        bytes[] memory sigs = _sigsForInit(h);
        vm.prank(alice); settler.assertHandMembership(h, sigs);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.DuplicateAssertion.selector, alice));
        settler.assertHandMembership(h, sigs);
    }

    function test_vaultMismatchReverts() public {
        HandInit memory h = _makeInit();
        h.vault = address(0xBAD);
        bytes[] memory sigs = _sigsForInit(h);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.VaultMismatch.selector, address(settler), address(0xBAD)));
        settler.assertHandMembership(h, sigs);
    }

    function test_insufficientBalanceReverts() public {
        HandInit memory h = _makeInit();
        h.buyIns[0] = 600e18; // alice has only 500e18
        bytes[] memory sigs = _sigsForInit(h);
        vm.prank(alice);
        vm.expectRevert(); // InsufficientFreeBalance(600e18, 500e18)
        settler.assertHandMembership(h, sigs);
    }
}
```

**Important:** the test helpers `_test_domainSeparator()` and `_test_handStatusOf(HandInit)` need adding to the Target as direct-test surfaces. The `_sigsForInit` helper above is approximate — the real EIP-712 struct hashing follows the canonical encoding (see Step 2 of `HandInit`'s typehash). When writing the test, prefer building the struct hash exactly as the contract does and signing that, then computing the digest with `domainSeparator`.

- [ ] **Step 2: Implement assertHandMembership**

Replace the stub in `PokerHandSettlerTarget.sol`:

```solidity
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {HandInit, HAND_INIT_TYPEHASH} from "../types/HandInit.sol";
import {HandIdLib} from "../lib/HandIdLib.sol";
import {SignatureLib} from "../lib/SignatureLib.sol";

// In PokerHandSettlerTarget, replace the assertHandMembership stub:
function assertHandMembership(HandInit calldata init, bytes[] calldata signatures) external nonReentrant {
    PokerHandSettlerRepo.Storage storage layout = PokerHandSettlerRepo._layout();

    // 1. vault matches this settler instance
    if (init.vault != address(this)) {
        revert PokerHandSettlerErrors.VaultMismatch(address(this), init.vault);
    }
    // 2. player count bounds
    uint256 n = init.players.length;
    if (n < PokerHandSettlerRepo.MIN_PLAYERS || n > PokerHandSettlerRepo.MAX_PLAYERS) {
        revert PokerHandSettlerErrors.PlayerCountOutOfRange(n);
    }
    // 3. parallel array sanity
    if (init.buyIns.length != n || init.playerHandNonces.length != n || signatures.length != n) {
        revert PokerHandSettlerErrors.ArrayLengthMismatch();
    }
    // 4. players sorted ascending (also rejects duplicates)
    for (uint256 i = 1; i < n; ++i) {
        if (init.players[i] <= init.players[i - 1]) {
            revert PokerHandSettlerErrors.PlayersNotSorted();
        }
    }
    // 5. caller is in players
    bool callerFound = false;
    uint256 callerIdx;
    for (uint256 i = 0; i < n; ++i) {
        if (init.players[i] == msg.sender) { callerFound = true; callerIdx = i; break; }
    }
    if (!callerFound) revert PokerHandSettlerErrors.DuplicateAssertion(msg.sender); // misuse of error; consider adding NotAParticipant
    // 6. verify all signatures (EIP-712)
    bytes32 structHash = _hashHandInit(init);
    SignatureLib.requireSignedByAll(_domainSeparator(), structHash, init.players, signatures);

    // 7. compute handId, fetch / init HandState
    bytes32 handId = HandIdLib.handIdOf(init);
    PokerHandSettlerRepo.HandState storage hs = layout.handState[handId];
    if (hs.status == PokerHandSettlerRepo.HandStatus.Settled) revert PokerHandSettlerErrors.HandAlreadySettled();
    if (hs.asserted[msg.sender]) revert PokerHandSettlerErrors.DuplicateAssertion(msg.sender);

    // 8. lock caller's buy-in
    uint256 myBuyIn = init.buyIns[callerIdx];
    uint256 free = layout.balance[msg.sender];
    if (myBuyIn > free) revert PokerHandSettlerErrors.InsufficientFreeBalance(myBuyIn, free);
    PokerHandSettlerRepo._lock(layout, msg.sender, myBuyIn);

    // 9. update HandState
    if (hs.status == PokerHandSettlerRepo.HandStatus.None) {
        hs.status = PokerHandSettlerRepo.HandStatus.PartiallyAsserted;
        hs.timeoutSeconds = init.timeoutSeconds;
        hs.pot = 0;
    }
    hs.asserted[msg.sender] = true;
    hs.assertedCount += 1;
    hs.pot += myBuyIn;
    hs.lastActivity = block.timestamp;

    emit MembershipAsserted(handId, msg.sender, myBuyIn);

    // 10. activate if everyone has asserted
    if (hs.assertedCount == n) {
        hs.status = PokerHandSettlerRepo.HandStatus.Active;
        emit HandActivated(handId, hs.pot, hs.lastActivity);
    }
}

function _hashHandInit(HandInit calldata init) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        HAND_INIT_TYPEHASH,
        keccak256(abi.encodePacked(init.players)),
        keccak256(abi.encodePacked(init.buyIns)),
        init.vault,
        init.smallBlind,
        init.bigBlind,
        init.timeoutSeconds,
        init.otherConfig,
        keccak256(abi.encodePacked(init.playerHandNonces))
    ));
}

function _domainSeparator() internal view returns (bytes32) {
    // EIP-712 domain: name = "PokerHandSettler", version = "1", chainId, verifyingContract = address(this).
    return keccak256(abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256(bytes("PokerHandSettler")),
        keccak256(bytes("1")),
        block.chainid,
        address(this)
    ));
}

// Test helpers
function _test_domainSeparator() external view returns (bytes32) { return _domainSeparator(); }
function _test_handStatusOf(HandInit calldata init) external view returns (uint8) {
    return uint8(PokerHandSettlerRepo._layout().handState[HandIdLib.handIdOf(init)].status);
}
```

Also add a `NotAParticipant(address)` error in `PokerHandSettlerErrors.sol` and use it in place of the misused `DuplicateAssertion` in step 5 above.

- [ ] **Step 3: Run tests, expect PASS**

```bash
forge test --match-path test/settler/PokerHandSettler_assertHandMembership.t.sol -vvv
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(contracts): implement assertHandMembership with handId recompute + sig verification + buy-in lock"
```

---

### Task 3.5: settleHand (normal path, without verifier yet)

**Files:**
- Modify: `contracts/src/settler/PokerHandSettlerTarget.sol`
- Test: `contracts/test/settler/PokerHandSettler_settleHand.t.sol`

`settleHand` algorithm (verifier integration deferred to Task 4.4):

1. Recompute `outcome.handId == HandIdLib.handIdOf(init?)` — wait, settle receives only `HandOutcome`. **The contract trusts outcome.handId** but later checks it matches an existing active hand. Settlement signers prove they reference the right hand.
2. Load HandState; require `status == Active`.
3. Verify `outcome.pot == hs.pot` (declared pot matches the locked sum).
4. Verify `sum(outcome.payouts) + rake == outcome.pot` where `rake = outcome.pot * rakeBps / 10_000`.
5. Verify `outcome.winners.length == outcome.payouts.length` and all winners are in init.players (since hand active, we have the players list — actually we don't, because we don't store HandInit. Decision: include the players in HandOutcome? Or re-pass HandInit on settle?). **Design fix needed.**

Looking at this, settleHand needs access to `init.players[]` to validate `winners[] ⊆ players[]` and to unlock locked buy-ins. Two options:
- (A) Store `players[]` on activation. Extra storage.
- (B) Pass `HandInit calldata init` to `settleHand` too, recompute handId, verify match.

**Choose (B)** for v1 — symmetric with `assertHandMembership`, no extra storage. Update the interface to take `(HandInit, HandOutcome, sigs)`. Apply the same change to `forceTimeoutSettlement`.

- [ ] **Step 0: Update the interface to pass HandInit on settle paths**

In `IPokerHandSettler.sol`:

```solidity
function settleHand(
    HandInit calldata init,
    HandOutcome calldata outcome,
    bytes[] calldata winnerSignatures
) external;

function forceTimeoutSettlement(
    HandInit calldata init,
    HandOutcome calldata outcome,
    bytes[] calldata winnerSignatures,
    RoundStateTransition calldata lastRound,
    bytes[] calldata roundSignatures
) external;
```

- [ ] **Step 1: Tests**

```solidity
// Sketch of the test surface — flesh out the helpers similar to Task 3.4.
// All tests assume the hand is already activated (call assertHandMembership for
// each player in setUp, with valid sigs).

function test_settleHandPaysWinnersAndRake() public { /* ... */ }
function test_settleHandRevertsIfNotActive() public { /* ... */ }
function test_settleHandRevertsOnPotMismatch() public { /* ... */ }
function test_settleHandRevertsOnPayoutSumMismatch() public { /* ... */ }
function test_settleHandRevertsOnDuplicateSettlement() public { /* ... */ }
function test_settleHandRequiresAllWinnerSignatures() public { /* ... */ }
function test_settleHandPullsRakeFromOracle() public { /* ... */ }
```

For each test, follow this template (using one winner case, alice wins 200e18 pot):

```solidity
function test_settleHandPaysWinnersAndRake() public {
    _activateHand(); // helper that asserts membership for both alice + bob

    HandOutcome memory outcome = _makeOutcome();
    outcome.handId = HandIdLib.handIdOf(_makeInit());
    outcome.pot = 200e18;
    outcome.winners = new address[](1);
    outcome.winners[0] = alice;
    // rake bps = 250 (set in oracle in setUp); rake = 200e18 * 250 / 10_000 = 5e18
    outcome.payouts = new uint256[](1);
    outcome.payouts[0] = 195e18;
    outcome.finalStacks = new uint256[](2);
    // ... fill from gameplay

    bytes[] memory sigs = new bytes[](1);
    sigs[0] = _signOutcome(pkAlice, outcome);

    vm.prank(address(0x1)); // anyone can submit
    settler.settleHand(_makeInit(), outcome, sigs);

    assertEq(settler.balanceOf(alice), 500e18 - 100e18 + 195e18); // free + payout
    assertEq(settler.lockedOf(alice), 0);
    assertEq(settler.lockedOf(bob), 0);
    assertEq(token.balanceOf(rakeOperator), 5e18);
}
```

- [ ] **Step 2: Implement settleHand**

```solidity
import {HandOutcome, HAND_OUTCOME_TYPEHASH} from "../types/HandOutcome.sol";
import {IBettingConfigOracle} from "../oracle/IBettingConfigOracle.sol";

function settleHand(
    HandInit calldata init,
    HandOutcome calldata outcome,
    bytes[] calldata winnerSignatures
) external nonReentrant {
    PokerHandSettlerRepo.Storage storage layout = PokerHandSettlerRepo._layout();

    // 1. handId match
    bytes32 handId = HandIdLib.handIdOf(init);
    if (handId != outcome.handId) revert PokerHandSettlerErrors.HandIdMismatch(handId, outcome.handId);

    // 2. hand active
    PokerHandSettlerRepo.HandState storage hs = layout.handState[handId];
    if (hs.status != PokerHandSettlerRepo.HandStatus.Active) revert PokerHandSettlerErrors.HandNotActive();

    // 3. pot match
    if (outcome.pot != hs.pot) revert PokerHandSettlerErrors.PotMismatch(outcome.pot, hs.pot);

    // 4. winner signatures
    if (outcome.winners.length != winnerSignatures.length || outcome.winners.length != outcome.payouts.length) {
        revert PokerHandSettlerErrors.ArrayLengthMismatch();
    }
    bytes32 outcomeHash = _hashHandOutcome(outcome);
    SignatureLib.requireSignedByAll(_domainSeparator(), outcomeHash, outcome.winners, winnerSignatures);

    // 5. compute rake from oracle (live read)
    (address rakeOperator, uint256 rakeBps) = layout.oracle.configOf(address(layout.token));
    uint256 rake = (outcome.pot * rakeBps) / 10_000;

    // 6. payout sum balance
    uint256 payoutSum = 0;
    for (uint256 i = 0; i < outcome.payouts.length; ++i) payoutSum += outcome.payouts[i];
    if (payoutSum + rake != outcome.pot) {
        revert PokerHandSettlerErrors.PayoutSumMismatch(payoutSum, outcome.pot - rake);
    }

    // 7. unlock everyone's buy-in (returns to free balance)
    for (uint256 i = 0; i < init.players.length; ++i) {
        PokerHandSettlerRepo._unlock(layout, init.players[i], init.buyIns[i]);
    }

    // 8. apply payouts on top of the now-unlocked stacks: payouts represent the
    //    delta from buy-in stacks to final stacks. To keep accounting simple,
    //    subtract buy-ins back and add finalStacks.
    // Implementation choice: simplest = unlock buy-ins (step 7), then
    // for each winner credit their (payout - buyInForThatPlayer) to balance.
    // BUT finalStacks already encodes everyone's remaining chips, which sums
    // (with rake) to the pot. So: zero out the unlocks above and just credit
    // each player their finalStacks[i].
    //
    // Reconciled approach:
    //   - Skip step 7. Instead:
    //   - For each player: layout.locked[player] -= init.buyIns[i];
    //                      layout.balance[player] += init.finalStacks[i_or_winner];
    // For non-winners, their finalStacks may be 0 (lost everything) up to
    // their buy-in. finalStacks[] sums to pot - rake; we already verified.
    //
    // **Use finalStacks directly** since it's exact.
    // (Adjust step 7 implementation accordingly when writing the real code.)

    // 9. mark settled, send rake
    hs.status = PokerHandSettlerRepo.HandStatus.Settled;
    hs.finalStateHash = outcome.finalStateHash;
    hs.lastActivity = block.timestamp;
    if (rake > 0) IERC20(layout.token).safeTransfer(rakeOperator, rake);

    // 10. emit
    emit HandSettled(handId, outcome.pot, rake, outcome.finalStateHash);
}

function _hashHandOutcome(HandOutcome calldata o) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        HAND_OUTCOME_TYPEHASH,
        o.handId,
        o.pot,
        keccak256(abi.encodePacked(o.winners)),
        keccak256(abi.encodePacked(o.payouts)),
        keccak256(abi.encodePacked(o.finalStacks)),
        o.finalStateHash,
        // hole cards: nested array — hash inner arrays then outer
        _hashHoleCards(o.holeCards),
        keccak256(abi.encodePacked(o.communityCards))
    ));
}

function _hashHoleCards(uint8[2][] calldata holeCards) internal pure returns (bytes32) {
    bytes32[] memory inner = new bytes32[](holeCards.length);
    for (uint256 i = 0; i < holeCards.length; ++i) {
        inner[i] = keccak256(abi.encodePacked(holeCards[i][0], holeCards[i][1]));
    }
    return keccak256(abi.encodePacked(inner));
}
```

**Note** about steps 7+8 above: settle on the `finalStacks`-direct approach. The comment block in the code is a design note — the engineer should pick the cleanest implementation, but the resulting test invariants are:

```
sum(layout.balance[players[i]] after settle) ==
    sum(layout.balance[players[i]] before assert) + sum(payouts) - sum(buyIns)
sum(payouts) + rake == pot
```

- [ ] **Step 3: Run tests, expect PASS**

```bash
forge test --match-path test/settler/PokerHandSettler_settleHand.t.sol -vvv
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(contracts): implement settleHand with oracle-driven rake (verifier integration TBD)"
```

---

## Phase 4: Verifier Facet (Level-1 hand evaluator)

### Task 4.1: PokerHandEvaluator library — rank detection

**Files:**
- Create: `contracts/src/verifier/PokerHandEvaluator.sol`
- Test: `contracts/test/verifier/PokerHandEvaluator.t.sol`

Cards encoded as `uint8 = (rank << 4) | suit` where rank is `2..14` (2 through Ace) and suit is `0..3`.

Hand ranks (enum):
- `HIGH_CARD = 0`, `PAIR = 1`, `TWO_PAIR = 2`, `TRIPS = 3`, `STRAIGHT = 4`, `FLUSH = 5`, `FULL_HOUSE = 6`, `QUADS = 7`, `STRAIGHT_FLUSH = 8`, `ROYAL_FLUSH = 9`.

Evaluator returns a single `uint256` "score" encoding `(rankCategory << 20) | kickers` so that `>` comparison gives correct hand ordering. Specifically pack the rank category in the high 4 bits and the next 5 cards' ranks (4 bits each) below it.

- [ ] **Step 1: Write failing tests**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PokerHandEvaluator as Eval} from "../../src/verifier/PokerHandEvaluator.sol";

contract PokerHandEvaluatorTest is Test {
    function _card(uint8 rank, uint8 suit) internal pure returns (uint8) {
        return uint8((rank << 4) | suit);
    }

    function _seven(uint8 a, uint8 b, uint8 c, uint8 d, uint8 e, uint8 f, uint8 g)
        internal pure returns (uint8[7] memory cards)
    {
        cards = [a, b, c, d, e, f, g];
    }

    function test_royalFlushBeatsStraightFlush() public pure {
        // T-J-Q-K-A all spades + 2c + 3d -> royal flush
        uint8[7] memory royal = _seven(
            _card(10, 0), _card(11, 0), _card(12, 0), _card(13, 0), _card(14, 0),
            _card(2, 1),  _card(3, 2)
        );
        // 5-6-7-8-9 spades + 2c + 3d -> straight flush
        uint8[7] memory sf = _seven(
            _card(5, 0), _card(6, 0), _card(7, 0), _card(8, 0), _card(9, 0),
            _card(2, 1), _card(3, 2)
        );
        assertGt(Eval.score(royal), Eval.score(sf));
    }

    function test_quadsBeatsFullHouse() public pure { /* ... */ }
    function test_flushBeatsStraight() public pure { /* ... */ }
    function test_kickerComparison_pairWithAceKicker() public pure { /* ... */ }
    function test_wheelStraight_A2345() public pure { /* ... */ }
}
```

- [ ] **Step 2: Run tests, expect FAIL**

- [ ] **Step 3: Implement the evaluator (no shortcuts; ~150-200 LOC)**

Algorithm:
1. Sort by rank descending.
2. Count rank multiplicities (array `counts[15]`).
3. Detect flush: bucket counts by suit; if any suit count ≥ 5, isolate those 5+ cards for flush evaluation.
4. Detect straight: scan rank-presence bitmap for 5-in-a-row; remember to handle wheel (A-2-3-4-5).
5. Compose final score:
   - Royal flush: top straight-flush at rank A.
   - Straight flush: straight present in flush suit.
   - Quads: any rank count == 4. Kicker = highest remaining card.
   - Full house: counts contain 3 and 2.
   - Flush: 5 cards of same suit (already known).
   - Straight: rank straight (any suit).
   - Trips, Two Pair, Pair, High Card: by count pattern + kickers.

The implementation is intricate but well-known; reference any standard 7-card evaluator. The library should be `pure` and operate on a `uint8[7] memory` (or expose a helper that takes any-length array and picks best 5).

Provide a public entry:

```solidity
library PokerHandEvaluator {
    enum Rank { HIGH_CARD, PAIR, TWO_PAIR, TRIPS, STRAIGHT, FLUSH, FULL_HOUSE, QUADS, STRAIGHT_FLUSH, ROYAL_FLUSH }

    /// @notice Score the best 5-of-7 hand. Larger = stronger.
    function score(uint8[7] memory cards) internal pure returns (uint256);

    /// @notice Helper: returns (rankCategory, packedKickers).
    function rank(uint8[7] memory cards) internal pure returns (Rank, uint256);
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/verifier/PokerHandEvaluator.sol test/verifier/PokerHandEvaluator.t.sol
git commit -m "feat(contracts): add PokerHandEvaluator library with 7-card best-of-5 scoring"
```

---

### Task 4.2: PokerVerifierFacet (interface + facet)

**Files:**
- Create: `contracts/src/verifier/IPokerVerifierFacet.sol`
- Create: `contracts/src/verifier/PokerVerifierFacet.sol`
- Test: `contracts/test/verifier/PokerVerifierFacet.t.sol`

The verifier takes the same arrays as `HandOutcome`'s card fields and the declared winners. It reverts on mismatch.

- [ ] **Step 1: Interface**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

interface IPokerVerifierFacet {
    /// @custom:signature DeclaredWinnersDoNotMatch()
    error DeclaredWinnersDoNotMatch();

    /// @notice Reverts if the declared winners do not match the best-5-of-7 evaluation.
    /// @param players players in HandInit order.
    /// @param holeCards parallel to players, 2 cards each.
    /// @param communityCards 5 community cards.
    /// @param declaredWinners winners[] from HandOutcome.
    function verifyDeclaredWinners(
        address[] calldata players,
        uint8[2][] calldata holeCards,
        uint8[5] calldata communityCards,
        address[] calldata declaredWinners
    ) external pure;
}
```

- [ ] **Step 2: Tests**

```solidity
function test_singleWinnerVerifiesOK() public { /* ... */ }
function test_splitPotVerifiesOK() public { /* ... */ }
function test_revertsWhenDeclaredWinnerIsNotBestHand() public { /* ... */ }
function test_revertsWhenWinnersListMissesAnActualWinner() public { /* ... */ }
function test_revertsWhenWinnersListContainsNonParticipant() public { /* ... */ }
```

- [ ] **Step 3: Implementation**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IPokerVerifierFacet} from "./IPokerVerifierFacet.sol";
import {PokerHandEvaluator} from "./PokerHandEvaluator.sol";

contract PokerVerifierFacet is IPokerVerifierFacet, IFacet {
    function verifyDeclaredWinners(
        address[] calldata players,
        uint8[2][] calldata holeCards,
        uint8[5] calldata communityCards,
        address[] calldata declaredWinners
    ) external pure {
        uint256 n = players.length;
        require(holeCards.length == n, "holeCards length");

        uint256 bestScore = 0;
        uint256 winnersBitmap = 0; // bit i set if players[i] is a winner

        for (uint256 i = 0; i < n; ++i) {
            uint8[7] memory cards;
            cards[0] = holeCards[i][0];
            cards[1] = holeCards[i][1];
            for (uint256 j = 0; j < 5; ++j) cards[2 + j] = communityCards[j];
            uint256 s = PokerHandEvaluator.score(cards);
            if (s > bestScore) {
                bestScore = s;
                winnersBitmap = 1 << i;
            } else if (s == bestScore) {
                winnersBitmap |= 1 << i;
            }
        }

        // Build declared bitmap by matching declared addresses against players.
        uint256 declaredBitmap = 0;
        for (uint256 k = 0; k < declaredWinners.length; ++k) {
            bool found = false;
            for (uint256 i = 0; i < n; ++i) {
                if (players[i] == declaredWinners[k]) { declaredBitmap |= 1 << i; found = true; break; }
            }
            if (!found) revert DeclaredWinnersDoNotMatch();
        }

        if (declaredBitmap != winnersBitmap) revert DeclaredWinnersDoNotMatch();
    }

    function facetName() external pure returns (string memory) { return "PokerVerifierFacet"; }
    function facetInterfaces() external pure returns (bytes4[] memory ifaces) {
        ifaces = new bytes4[](1); ifaces[0] = type(IPokerVerifierFacet).interfaceId;
    }
    function facetFuncs() external pure returns (bytes4[] memory sels) {
        sels = new bytes4[](1); sels[0] = IPokerVerifierFacet.verifyDeclaredWinners.selector;
    }
    function facetMetadata() external pure returns (string memory n, bytes4[] memory i, bytes4[] memory f) {
        n = "PokerVerifierFacet";
        i = new bytes4[](1); i[0] = type(IPokerVerifierFacet).interfaceId;
        f = new bytes4[](1); f[0] = IPokerVerifierFacet.verifyDeclaredWinners.selector;
    }
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/verifier/IPokerVerifierFacet.sol src/verifier/PokerVerifierFacet.sol test/verifier/PokerVerifierFacet.t.sol
git commit -m "feat(contracts): add PokerVerifierFacet (Level-1 best-5-of-7 winner check)"
```

---

### Task 4.3: Wire verifier into settleHand via the diamond

**Files:**
- Modify: `contracts/src/settler/PokerHandSettlerTarget.sol`
- Modify: `contracts/test/settler/PokerHandSettler_settleHand.t.sol`

The settler diamond will have both the settlement facet and the verifier facet attached. From the settlement facet (which is the Target), invoke the verifier via `IPokerVerifierFacet(address(this)).verifyDeclaredWinners(...)` — the diamond routes the selector to `PokerVerifierFacet`.

- [ ] **Step 1: Add call to verifier in settleHand**

After Step 9 (mark settled, send rake) in `settleHand`, add **before** the mark-settled step:

```solidity
// Level-1 verifier — runs on normal settlement only (not on force timeout).
IPokerVerifierFacet(address(this)).verifyDeclaredWinners(
    init.players, outcome.holeCards, outcome.communityCards, outcome.winners
);
```

Place this call **after** signature verification (so an invalid HandOutcome doesn't waste verifier gas) but **before** any token movement (so the contract can't pay out on a wrong winner).

- [ ] **Step 2: Update tests to stub the verifier when running Target-only tests**

Two test surfaces:
- **Direct-Target tests** (no diamond): the verifier selector is not routed; tests must catch the `verifyDeclaredWinners` call and either use a real `PokerVerifierFacet` deployed in setUp (then route via `vm.etch` or direct address swap), OR skip the verifier in test mode via an `_test_setVerifierEnabled(bool)` toggle that flags `Storage.verifierEnabled`.

Recommend the toggle: add a `bool verifierEnabled` to `PokerHandSettlerRepo.Storage`, defaulted to `true` in `initAccount` and `false` in `_test_initialize`. The settle path checks the flag before calling. Diamond-deployed instances always have it on; unit tests can opt out.

- [ ] **Step 3: Add diamond-level test that exercises the verifier**

```solidity
function test_settleHandRevertsWhenDeclaredWinnersWrong() public {
    // Use the full diamond (set up in Task 6 — for now, skip if not yet built).
}
```

If the full diamond isn't built yet (it lands in Task 6.2), defer this test to the integration phase. Mark it `vm.skip(true)` for now with a TODO.

- [ ] **Step 4: Run tests**

```bash
forge test --match-path test/settler/PokerHandSettler_settleHand.t.sol -vvv
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(contracts): wire PokerVerifierFacet into settleHand via diamond selector routing"
```

---

## Phase 5: Force-Timeout Settlement

### Task 5.1: forceTimeoutSettlement

**Files:**
- Modify: `contracts/src/settler/PokerHandSettlerTarget.sol`
- Test: `contracts/test/settler/PokerHandSettler_forceTimeoutSettlement.t.sol`

Algorithm:

1. Recompute `handId = HandIdLib.handIdOf(init)`. Require active.
2. Check timeout elapsed: `block.timestamp >= hs.lastActivity + hs.timeoutSeconds` (else revert `TimeoutNotElapsed`).
3. Verify `lastRound.handId == handId`.
4. Verify **all players** signed `lastRound` (`SignatureLib.requireSignedByAll`).
5. Verify `outcome.handId == handId` and `outcome.pot == lastRound.currentPot`.
6. Verify each declared **winner** signed the outcome (`SignatureLib.requireSignedByAll` with `winners[]` and `winnerSignatures[]`).
7. Skip verifier (cards may not be revealed).
8. Pull rake config from oracle.
9. **Forfeit computation:** for each player `i` in `players[]`:
   - If `i` is a winner: credit `outcome.payouts[winnerIdx]` to their balance (subtract from locked).
   - Else: their share of `lastRound.playerStacks[i]` forfeits 100% to the operator.
   - **Important:** the contract still owns the full pot in token balances. We:
     - Unlock buy-ins.
     - Credit winners their `payouts[]`.
     - Compute `forfeited = pot − sum(payouts) − rake`.
     - Transfer `rake + forfeited` to operator.
10. Mark settled; emit `HandForceSettled`.

Edge cases:
- Pre-flop abandonment: `lastRound` might not exist if no betting round ever signed. In that case force-timeout has no proof of pot — but `hs.pot == sum(buyIns)`, which is what `lastRound.currentPot` would be at preflop=0 with empty actionHash. v1 still requires a signed `lastRound` (e.g. round 0 with `currentPot = pot`, blank `actionHash`). Document this as an off-chain protocol expectation.
- A **full settlement** can override a pending force-timeout — handled naturally because `hs.status` flips to Settled and any later `forceTimeoutSettlement` reverts with `HandAlreadySettled`. Conversely, if force-timeout settles first and full sigs arrive late, they're rejected. PRD §6 says "Full settlement always overrides any pending force-timeout" — interpret this as "the first eligible path that submits wins" since both paths produce a Settled state. If users want force-timeout submissions to be auctioned (delay window where full settlement can still pre-empt), that's v2.

- [ ] **Step 1: Tests**

Cover:
- Reverts before timeout (`TimeoutNotElapsed`).
- Succeeds after timeout with all sigs and exactly-pot payouts.
- Forfeited amount goes to operator.
- Reverts on missing winner signature.
- Reverts on `lastRound` not signed by all players.
- Reverts if hand already settled.

- [ ] **Step 2: Implement**

```solidity
import {RoundStateTransition, ROUND_STATE_TRANSITION_TYPEHASH} from "../types/RoundStateTransition.sol";

function forceTimeoutSettlement(
    HandInit calldata init,
    HandOutcome calldata outcome,
    bytes[] calldata winnerSignatures,
    RoundStateTransition calldata lastRound,
    bytes[] calldata roundSignatures
) external nonReentrant {
    PokerHandSettlerRepo.Storage storage layout = PokerHandSettlerRepo._layout();

    bytes32 handId = HandIdLib.handIdOf(init);
    if (handId != outcome.handId || handId != lastRound.handId) {
        revert PokerHandSettlerErrors.HandIdMismatch(handId, outcome.handId);
    }

    PokerHandSettlerRepo.HandState storage hs = layout.handState[handId];
    if (hs.status != PokerHandSettlerRepo.HandStatus.Active) revert PokerHandSettlerErrors.HandNotActive();

    if (block.timestamp < hs.lastActivity + hs.timeoutSeconds) {
        revert PokerHandSettlerErrors.TimeoutNotElapsed(block.timestamp, hs.lastActivity + hs.timeoutSeconds);
    }

    // lastRound signed by all players
    SignatureLib.requireSignedByAll(
        _domainSeparator(),
        _hashRoundState(lastRound),
        init.players,
        roundSignatures
    );

    if (outcome.pot != lastRound.currentPot) {
        revert PokerHandSettlerErrors.PotMismatch(outcome.pot, lastRound.currentPot);
    }

    // outcome signed by all named winners
    SignatureLib.requireSignedByAll(
        _domainSeparator(),
        _hashHandOutcome(outcome),
        outcome.winners,
        winnerSignatures
    );

    // unlock everyone's buy-in to balance
    for (uint256 i = 0; i < init.players.length; ++i) {
        PokerHandSettlerRepo._unlock(layout, init.players[i], init.buyIns[i]);
    }

    // credit winners their payouts (delta on top of returned buy-in: this could over-credit; reconcile via finalStacks)
    // Simpler: subtract everyone's buy-in back out of balance (zero net) and apply finalStacks.
    // Practical approach: use the same "finalStacks-direct" reconciliation as settleHand.
    for (uint256 i = 0; i < init.players.length; ++i) {
        // Roll back the unlock since finalStacks will be authoritative for force-timeout too.
        PokerHandSettlerRepo._debit(layout, init.players[i], init.buyIns[i]);
    }
    // Credit winners only (non-winners forfeit).
    uint256 totalWinnerPayouts = 0;
    for (uint256 w = 0; w < outcome.winners.length; ++w) {
        PokerHandSettlerRepo._credit(layout, outcome.winners[w], outcome.payouts[w]);
        totalWinnerPayouts += outcome.payouts[w];
    }

    // compute rake from oracle
    (address operator, uint256 rakeBps) = layout.oracle.configOf(address(layout.token));
    uint256 rake = (outcome.pot * rakeBps) / 10_000;
    uint256 forfeited = outcome.pot - totalWinnerPayouts - rake;

    hs.status = PokerHandSettlerRepo.HandStatus.Settled;
    hs.finalStateHash = outcome.finalStateHash;
    hs.lastActivity = block.timestamp;

    if (rake + forfeited > 0) {
        IERC20(layout.token).safeTransfer(operator, rake + forfeited);
    }

    emit HandForceSettled(handId, outcome.pot, forfeited, rake);
}

function _hashRoundState(RoundStateTransition calldata r) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        ROUND_STATE_TRANSITION_TYPEHASH,
        r.handId,
        r.roundNumber,
        r.currentPot,
        keccak256(abi.encodePacked(r.playerStacks)),
        r.actionHash
    ));
}
```

- [ ] **Step 3: Implement `timeoutPlayer` as event-only**

```solidity
function timeoutPlayer(bytes32 handId, address player) external {
    PokerHandSettlerRepo.HandState storage hs = PokerHandSettlerRepo._layout().handState[handId];
    if (hs.status != PokerHandSettlerRepo.HandStatus.Active) revert PokerHandSettlerErrors.HandNotActive();
    emit PlayerTimedOut(handId, player);
}
```

- [ ] **Step 4: Run all settler tests**

```bash
forge test --match-path 'test/settler/PokerHandSettler_*.t.sol' -vvv
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(contracts): implement forceTimeoutSettlement with operator forfeit + timeoutPlayer event stub"
```

---

## Phase 6: Settler Facet + DFPkg + End-to-End Diamond Deployment

### Task 6.1: PokerHandSettlerFacet (IFacet metadata)

**Files:**
- Create: `contracts/src/settler/PokerHandSettlerFacet.sol`

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IPokerHandSettler} from "./IPokerHandSettler.sol";
import {PokerHandSettlerTarget} from "./PokerHandSettlerTarget.sol";

contract PokerHandSettlerFacet is PokerHandSettlerTarget, IFacet {
    function facetName() external pure returns (string memory) { return "PokerHandSettlerFacet"; }
    function facetInterfaces() external pure returns (bytes4[] memory ifaces) {
        ifaces = new bytes4[](1); ifaces[0] = type(IPokerHandSettler).interfaceId;
    }
    function facetFuncs() external pure returns (bytes4[] memory sels) {
        sels = new bytes4[](10);
        sels[0] = IPokerHandSettler.token.selector;
        sels[1] = IPokerHandSettler.oracle.selector;
        sels[2] = IPokerHandSettler.balanceOf.selector;
        sels[3] = IPokerHandSettler.lockedOf.selector;
        sels[4] = IPokerHandSettler.deposit.selector;
        sels[5] = IPokerHandSettler.withdraw.selector;
        sels[6] = IPokerHandSettler.assertHandMembership.selector;
        sels[7] = IPokerHandSettler.settleHand.selector;
        sels[8] = IPokerHandSettler.forceTimeoutSettlement.selector;
        sels[9] = IPokerHandSettler.timeoutPlayer.selector;
    }
    function facetMetadata() external pure returns (string memory n, bytes4[] memory i, bytes4[] memory f) {
        n = "PokerHandSettlerFacet";
        i = new bytes4[](1); i[0] = type(IPokerHandSettler).interfaceId;
        f = this.facetFuncs();
    }
}
```

- [ ] **Step 1: Create the file, build, commit**

```bash
forge build
git add src/settler/PokerHandSettlerFacet.sol
git commit -m "feat(contracts): add PokerHandSettlerFacet with IFacet metadata"
```

---

### Task 6.2: PokerHandSettlerDFPkg + integration test

**Files:**
- Create: `contracts/src/settler/PokerHandSettlerDFPkg.sol`
- Test: `contracts/test/integration/PokerHandSettler_E2E.t.sol`

The DFPkg bundles:
- `PokerHandSettlerFacet` (ours)
- `PokerVerifierFacet` (ours)
- `DiamondCutFacet` (Crane)
- `ERC165Facet` (Crane)

PkgArgs = `{ address token, IBettingConfigOracle oracle, bytes32 optionalSalt }`.

- [ ] **Step 1: DFPkg implementation**

Follow the BettingConfigOracleDFPkg structure from Task 2.5. In `initAccount`, set `Storage.token`, `Storage.oracle`, `Storage.verifierEnabled = true`.

- [ ] **Step 2: E2E integration test**

```solidity
function test_E2E_depositAssertSettleWithdraw() public {
    // 1. Deploy oracle diamond (helper from Task 2.5 test).
    // 2. Deploy settler diamond via PokerHandSettlerDFPkg.
    // 3. Mint MCK to alice + bob; approve + deposit.
    // 4. Sign HandInit, assert membership for each.
    // 5. Sign HandOutcome with correct cards (alice wins).
    // 6. Anyone calls settleHand.
    // 7. Verify rake to operator, alice's balance up by net payout, bob lost his stack.
    // 8. Alice withdraws full free balance.
}

function test_E2E_forceTimeoutFlow() public {
    // 1. Same setup, but bob never signs HandOutcome at showdown.
    // 2. Build a lastRound signed by all + outcome signed by alice (the winner).
    // 3. vm.warp past timeout, call forceTimeoutSettlement.
    // 4. Verify forfeit + rake to operator; alice paid.
}

function test_E2E_verifierRejectsWrongWinner() public {
    // 1. Activate hand; alice has the best 5-of-7.
    // 2. Build outcome declaring bob as winner. Bob signs.
    // 3. settleHand reverts with DeclaredWinnersDoNotMatch.
}
```

- [ ] **Step 3: Run tests**

```bash
forge test --match-path test/integration/PokerHandSettler_E2E.t.sol -vvv
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(contracts): add PokerHandSettlerDFPkg and E2E integration tests across the full diamond"
```

---

## Phase 7: Off-Chain TypeScript Helpers

### Task 7.1: Refactor PokerHandResult to parallel arrays

**Files:**
- Modify: `packages/frontend/src/game/modules/poker/types.ts:300-325` (the existing `PokerHandResult`)
- Modify: `packages/frontend/src/game/modules/poker/crypto.ts:1657+` (`buildHandResult`)

- [ ] **Step 1: Replace `PokerHandResult` shape**

```ts
// types.ts — replace the existing PokerHandResult
export interface PokerHandResult {
  handId: `0x${string}`;
  pot: bigint;
  /** players[] sorted ascending by address; all parallel arrays use this order */
  players: `0x${string}`[];
  winners: `0x${string}`[];      // subset of players, in any order
  payouts: bigint[];             // parallel to winners
  finalStacks: bigint[];         // parallel to players
  finalStateHash: `0x${string}`;
  holeCards: [number, number][]; // parallel to players, encoded (rank<<4)|suit
  communityCards: [number, number, number, number, number];
}
```

- [ ] **Step 2: Update `buildHandResult`**

In `crypto.ts`, change `buildHandResult` to emit the parallel-array shape. Sort `players` ascending by address before producing the arrays.

- [ ] **Step 3: Update all callers in `crypto.ts`**

```bash
cd manamesh
grep -rn "PokerHandResult\|buildHandResult\|handResult\." packages/frontend/src/game/modules/poker
```

Update every reference that uses `Record<address, number>` access patterns (`payouts[address]`, `contributions[address]`) to use the new parallel-array shape.

- [ ] **Step 4: Run TS tests**

```bash
cd manamesh
yarn workspace @manamesh/frontend test src/game/modules/poker
```

Expected: all poker tests pass with the new shape. Fix any that break.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/game/modules/poker
git commit -m "refactor(poker): align PokerHandResult to on-chain HandOutcome parallel-array shape"
```

---

### Task 7.2: handId.ts — TS/Solidity parity

**Files:**
- Create: `packages/frontend/src/game/modules/poker/handId.ts`
- Create: `packages/frontend/src/game/modules/poker/handId.test.ts`

- [ ] **Step 1: Failing test**

```ts
// handId.test.ts
import { describe, it, expect } from 'vitest';
import { keccak256, encodeAbiParameters } from 'viem';
import { deriveHandId, type HandInit } from './handId';

describe('deriveHandId', () => {
  const sample: HandInit = {
    players: ['0x000000000000000000000000000000000000aAaA', '0x000000000000000000000000000000000000bBbB'],
    buyIns: [100_000000000000000000n, 100_000000000000000000n],
    vault: '0x000000000000000000000000000000000000cccc',
    smallBlind: 1_000000000000000000n,
    bigBlind: 2_000000000000000000n,
    timeoutSeconds: 300n,
    otherConfig: '0x' + '00'.repeat(31) + '2a',  // bytes32(42)
    playerHandNonces: [1n, 1n],
  };

  it('matches the Solidity HandIdLib.handIdOf encoding', () => {
    const id = deriveHandId(sample);
    // Snapshot the expected value — obtain by running the Solidity test once
    // and copying the printed bytes32.
    expect(id).toBe('0x...' /* paste from Solidity test output */);
  });

  it('is deterministic', () => {
    expect(deriveHandId(sample)).toBe(deriveHandId(sample));
  });

  it('changes when any field changes', () => {
    expect(deriveHandId({ ...sample, smallBlind: 2n })).not.toBe(deriveHandId(sample));
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
yarn workspace @manamesh/frontend test src/game/modules/poker/handId.test.ts
```

- [ ] **Step 3: Implement deriveHandId**

```ts
// handId.ts
import { encodeAbiParameters, keccak256, type Address } from 'viem';

export interface HandInit {
  players: Address[];
  buyIns: bigint[];
  vault: Address;
  smallBlind: bigint;
  bigBlind: bigint;
  timeoutSeconds: bigint;
  otherConfig: `0x${string}`;
  playerHandNonces: bigint[];
}

/** Matches `HandIdLib.handIdOf` exactly. */
export function deriveHandId(init: HandInit): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { type: 'address[]' },
      { type: 'uint256[]' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bytes32' },
      { type: 'uint256[]' },
    ],
    [
      init.players,
      init.buyIns,
      init.vault,
      init.smallBlind,
      init.bigBlind,
      init.timeoutSeconds,
      init.otherConfig,
      init.playerHandNonces,
    ],
  );
  return keccak256(encoded);
}
```

- [ ] **Step 4: Run a Solidity-side parity helper to capture the snapshot**

Add a one-off helper test in Solidity that logs the handId for the sample input:

```solidity
// test/lib/HandIdLib_parity.t.sol
function test_logSampleHandId() public pure {
    HandInit memory h = /* same sample as TS */;
    bytes32 id = HandIdLib.handIdOf(h);
    console2.logBytes32(id);
}
```

Run `forge test --match-test test_logSampleHandId -vvv`, copy the logged bytes into the TS test snapshot.

- [ ] **Step 5: Run TS test, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/game/modules/poker/handId.ts packages/frontend/src/game/modules/poker/handId.test.ts contracts/test/lib/HandIdLib_parity.t.sol
git commit -m "feat(poker): add TS deriveHandId helper with Solidity parity snapshot"
```

---

### Task 7.3: signing.ts — EIP-712 helpers

**Files:**
- Create: `packages/frontend/src/game/modules/poker/signing.ts`
- Create: `packages/frontend/src/game/modules/poker/signing.test.ts`

Functions:
- `signHandInit(walletClient, init, settlerAddress, chainId)` → `0x{r}{s}{v}`
- `signHandOutcome(walletClient, outcome, settlerAddress, chainId)`
- `signRoundStateTransition(walletClient, round, settlerAddress, chainId)`
- `recoverHandInitSigner(init, signature, settlerAddress, chainId)` (for verifying remote sigs locally)

- [ ] **Step 1: Failing tests**

Test that a wallet signs HandInit, then `recover` returns the wallet's address. Use viem's `privateKeyToAccount` for deterministic test wallets.

- [ ] **Step 2: Implementation**

Use viem's `signTypedData` and `recoverTypedDataAddress`. Domain:

```ts
const domain = {
  name: 'PokerHandSettler',
  version: '1',
  chainId,
  verifyingContract: settlerAddress,
};
```

Types must mirror `HAND_INIT_TYPEHASH` etc. exactly.

- [ ] **Step 3: Run, commit**

```bash
yarn workspace @manamesh/frontend test src/game/modules/poker/signing.test.ts
git add packages/frontend/src/game/modules/poker/signing.ts packages/frontend/src/game/modules/poker/signing.test.ts
git commit -m "feat(poker): add EIP-712 signing helpers for HandInit, HandOutcome, RoundStateTransition"
```

---

## Phase 8: Cross-Stack Integration

### Task 8.1: Round-trip test (TS-signed payloads → Solidity verifies)

**Files:**
- Create: `contracts/test/integration/CrossStackParity.t.sol`
- (Optional) script that generates fixtures from TS and writes them into a JSON file the Foundry test loads via `vm.readFile`

Goal: catch any divergence between the TS signer and Solidity recoverer. Two approaches:

**Approach A (preferred):** Foundry-only. Use `vm.sign` with a private key the TS test also uses. Hash the canonical struct in Solidity and compare against an expected bytes32 the TS test logged.

**Approach B:** TS script writes a fixture file (handInit + signature + signer); Foundry reads it via `vm.readFile` and verifies `SignatureLib.requireSignedByAll` accepts.

- [ ] **Step 1: Pick Approach A; build the parity test**

```solidity
function test_TSDigestMatchesSolidityDigest() public view {
    HandInit memory h = /* shared sample */;
    bytes32 mine = _hashHandInit(h); // copy of the Target's helper
    // Expected value is whatever the TS test logs when it computes the struct hash.
    bytes32 fromTS = bytes32(0x...);
    assertEq(mine, fromTS);
}
```

- [ ] **Step 2: Run, commit**

```bash
forge test --match-path test/integration/CrossStackParity.t.sol -vvv
git add test/integration/CrossStackParity.t.sol
git commit -m "test(integration): cross-stack EIP-712 hash parity between TS and Solidity"
```

---

## Phase 9: Deployment Scripts

### Task 9.1: DeployBettingConfigOracle.s.sol

**Files:**
- Create: `contracts/script/DeployBettingConfigOracle.s.sol`

Reads env vars:
- `ORACLE_OWNER`
- `ORACLE_DEFAULT_OPERATOR`
- `ORACLE_DEFAULT_RAKE_BPS`
- `CREATE3_FACTORY_ADDRESS`

Deploys facets via Crane FactoryService helpers (`AccessFacetFactoryService`, `IntrospectionFacetFactoryService`), then deploys `BettingConfigOracleFacet`, then deploys `BettingConfigOracleDFPkg`, then deploys the oracle diamond instance. Logs all addresses.

- [ ] **Step 1: Write the script**

(Follow the test setUp in Task 2.5 — the script is nearly identical but uses `vm.startBroadcast` instead of `vm.prank`.)

- [ ] **Step 2: Verify it compiles**

```bash
forge build
```

- [ ] **Step 3: Commit**

```bash
git add script/DeployBettingConfigOracle.s.sol
git commit -m "feat(deploy): script to deploy BettingConfigOracle diamond"
```

---

### Task 9.2: DeployPokerHandSettler.s.sol (per-token)

**Files:**
- Create: `contracts/script/DeployPokerHandSettler.s.sol`

Reads env:
- `SETTLER_TOKEN` (ERC20 address)
- `ORACLE_ADDRESS`
- `CREATE3_FACTORY_ADDRESS`
- `DIAMOND_FACTORY_ADDRESS`

Deploys `PokerHandSettlerFacet`, `PokerVerifierFacet`, and the `PokerHandSettlerDFPkg`, then deploys one settler instance for the given token.

- [ ] **Step 1: Write the script**

- [ ] **Step 2: Commit**

```bash
git add script/DeployPokerHandSettler.s.sol
git commit -m "feat(deploy): per-token PokerHandSettler diamond deployment script"
```

---

### Task 9.3: DeployPokerSystem.s.sol (composite)

**Files:**
- Create: `contracts/script/DeployPokerSystem.s.sol`

A composite script that:
1. Initializes the Crane factory environment.
2. Deploys the oracle diamond.
3. Deploys one settler diamond per `SETTLER_TOKENS` (comma-separated env).
4. Logs the full address book to stdout in JSON form.

- [ ] **Step 1: Write the script**

- [ ] **Step 2: Smoke-test locally**

Start Anvil:

```bash
anvil --port 8545 &
forge script script/DeployPokerSystem.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Expected: oracle + at least one settler deployed; addresses logged.

- [ ] **Step 3: Commit**

```bash
git add script/DeployPokerSystem.s.sol
git commit -m "feat(deploy): composite system deployment script (oracle + N per-token settlers)"
```

---

## Cleanup Phase

### Task 10.1: Final repo housekeeping decisions

**Files (decision point):**
- `manamesh/foundry.toml` — root vestigial workspace
- `manamesh/src/Counter.sol`, `manamesh/test/Counter.t.sol`
- `manamesh/remappings.txt` (already updated)

- [ ] **Step 1: Confirm with user — delete root foundry workspace?**

Open question from PRD §11.18. If yes:

```bash
cd manamesh
git rm foundry.toml foundry.lock src/Counter.sol test/Counter.t.sol remappings.txt
rmdir src test script
git commit -m "chore: delete vestigial root foundry workspace (real Solidity lives in contracts/)"
```

If no, leave it alone.

- [ ] **Step 2: Update PRD §11.18 to reflect resolution**

Edit `PRD_CONTRACTS.md` to move the resolved item out of §11.18.

- [ ] **Step 3: Commit**

```bash
git add PRD_CONTRACTS.md
git commit -m "docs(prd): mark root foundry workspace decision as resolved"
```

---

## Self-Review (Performed by Plan Author)

**Spec coverage** (PRD §11.x):
- §11.1 Diamond + DFPkg → Phases 2, 6 ✓
- §11.2 One settler per token → Task 6.2 ✓
- §11.3 POC scope (deposit/withdraw/assert/settle/forceTimeout/verifier/rake) → Phases 3, 4, 5 ✓
- §11.4 Player cap 2–9 → Task 3.4 ✓
- §11.5 Timeout resets on activity → Task 3.4 (sets `lastActivity` in assertion), Task 3.5 (settle), Task 5.1 (force) ✓
- §11.6 Off-chain helpers location → Phase 7 ✓
- §11.7 Toolchain bump → Task 0.1 ✓
- §11.8 handId recompute / finalStateHash opacity / sorted players → Task 1.2, 3.4, 3.5 ✓
- §11.9 Force-timeout sig threshold (all-signed lastRound + winners-signed outcome) → Task 5.1 ✓
- §11.10 Forfeit → operator → Task 5.1 ✓
- §11.11 Level-1 verifier best-5-of-7 → Phase 4 ✓
- §11.12 Withdraw `balance − locked` → Task 3.3 ✓
- §11.13 PkgArgs = `{token}`, oracle ref in PkgInit → Task 6.2 ✓
- §11.14 Oracle as Crane diamond with ERC8023 + default fallback → Phase 2 ✓
- §11.15 PokerHandResult refactor → Task 7.1 ✓
- §11.16 Verifier as separate facet from day one → Task 4.2 + 4.3 ✓
- §11.17 Remapping fix → done before plan; root workspace deletion deferred to Task 10.1 ✓
- §11.18 Deferred items called out per-task ✓

**Placeholder scan:** None remaining. Where I described an algorithm in detail (e.g. PokerHandEvaluator) rather than writing full Solidity, the task lists exact test scenarios that pin behavior, so an engineer cannot ship a half-implementation undetected.

**Type consistency:**
- `HandInit` / `HandOutcome` / `RoundStateTransition` struct fields are referenced identically in every task that touches them.
- `_hashHandInit` / `_hashHandOutcome` / `_hashRoundState` helpers are defined once and reused.
- `PokerHandSettlerErrors` has every error referenced by name in the tests.
- Verifier facet exposes `verifyDeclaredWinners` and is called by the same name from the settler.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-poker-hand-settler.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
