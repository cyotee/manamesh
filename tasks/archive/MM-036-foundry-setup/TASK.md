# Task MM-036: Foundry Setup

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-31
**Dependencies:** None
**Worktree:** `feature/foundry-setup`

---

## Description

Install and configure Foundry for smart contract development. Set up the `contracts/` directory structure with foundry.toml configuration and forge-std for testing. This is a prerequisite for MM-035 (Bet Settlement & Escrow Vault) and any other blockchain contract work.

## Dependencies

None - this is a foundational setup task.

## User Stories

### US-MM-036.1: Foundry Installation

As a developer, I want Foundry installed and configured so that I can develop smart contracts.

**Acceptance Criteria:**
- [ ] `foundry.toml` created at `contracts/foundry.toml`
- [ ] Source directory configured as `contracts/src/`
- [ ] Test directory configured as `contracts/test/`
- [ ] Script directory configured as `contracts/script/`
- [ ] Output directory configured as `contracts/out/`
- [ ] Cache directory configured as `contracts/cache/`
- [ ] forge-std installed as dependency
- [ ] `forge build` runs successfully
- [ ] `forge test` runs successfully (with placeholder test)

### US-MM-036.2: Directory Structure

As a developer, I want a standard Foundry directory structure so that contracts are organized consistently.

**Acceptance Criteria:**
- [ ] `contracts/src/` directory created
- [ ] `contracts/test/` directory created
- [ ] `contracts/script/` directory created
- [ ] `contracts/lib/` directory created (for dependencies)
- [ ] `.gitkeep` files in empty directories
- [ ] Placeholder `Counter.sol` and `Counter.t.sol` for verification

### US-MM-036.3: Git Integration

As a developer, I want proper git configuration for Foundry artifacts.

**Acceptance Criteria:**
- [ ] `contracts/out/` added to `.gitignore`
- [ ] `contracts/cache/` added to `.gitignore`
- [ ] `contracts/lib/` tracked via git submodules (Foundry default)
- [ ] forge-std added as git submodule

### US-MM-036.4: Solidity Configuration

As a developer, I want reasonable Solidity compiler defaults.

**Acceptance Criteria:**
- [ ] Solidity version set to 0.8.24 or latest stable
- [ ] Optimizer enabled with reasonable runs (200)
- [ ] Via-IR enabled for better optimization
- [ ] EVM version set to `cancun` (latest)
- [ ] Remappings configured for dependencies

## Technical Details

### Directory Structure

```
contracts/
├── foundry.toml          # Foundry configuration
├── remappings.txt        # Import remappings (optional, can be in toml)
├── src/
│   └── Counter.sol       # Placeholder contract
├── test/
│   └── Counter.t.sol     # Placeholder test
├── script/
│   └── .gitkeep
└── lib/
    └── forge-std/        # Git submodule
```

### foundry.toml Configuration

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
cache_path = "cache"

# Compiler settings
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
via_ir = true
evm_version = "cancun"

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

### Placeholder Counter Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Counter
/// @notice Placeholder contract to verify Foundry setup
contract Counter {
    uint256 public number;

    function setNumber(uint256 newNumber) public {
        number = newNumber;
    }

    function increment() public {
        number++;
    }
}
```

### Placeholder Test

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";

contract CounterTest is Test {
    Counter public counter;

    function setUp() public {
        counter = new Counter();
        counter.setNumber(0);
    }

    function test_Increment() public {
        counter.increment();
        assertEq(counter.number(), 1);
    }

    function testFuzz_SetNumber(uint256 x) public {
        counter.setNumber(x);
        assertEq(counter.number(), x);
    }
}
```

## Files to Create

**New Files:**
- `contracts/foundry.toml` - Foundry configuration
- `contracts/src/Counter.sol` - Placeholder contract
- `contracts/test/Counter.t.sol` - Placeholder test
- `contracts/script/.gitkeep` - Empty directory marker

**Modified Files:**
- `.gitignore` - Add contracts/out/ and contracts/cache/
- `.gitmodules` - Add forge-std submodule

## Inventory Check

Before starting, verify:
- [ ] Foundry installed locally (`forge --version` works)
- [ ] Git available for submodule operations
- [ ] No existing contracts/ directory conflicts

## Installation Commands

```bash
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Initialize in contracts/ directory
cd contracts
forge init --no-git --no-commit .

# Add forge-std as submodule
git submodule add https://github.com/foundry-rs/forge-std lib/forge-std

# Verify setup
forge build
forge test
```

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] `forge build` succeeds from contracts/ directory
- [ ] `forge test` passes with placeholder test
- [ ] Git submodule for forge-std properly configured
- [ ] No build artifacts committed to git

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
