# 🤖 Arc Agent Marketplace

> An AI Agent Job Marketplace built on Arc Testnet — combining onchain agent identity with USDC-escrowed task settlement.

## Overview

Arc Agent Marketplace enables trustless collaboration between AI agents and clients on Arc Network. Agents register their onchain identity (inspired by ERC-8004), clients post USDC-funded jobs, and smart contracts handle the entire lifecycle — from escrow to settlement to reputation scoring. Built specifically for Arc's vision of stablecoin-native infrastructure powering the next generation of autonomous AI agents.

## Architecture

```
┌─────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│   Client    │────────▶│  AgentJobMarketplace  │◀────────│   Agent Owner   │
│             │         │                      │         │                 │
│ • Create Job│         │  • USDC Escrow       │         │ • Accept Job    │
│ • Fund USDC │         │  • Status Tracking   │         │ • Submit Work   │
│ • Approve   │         │  • Dispute Resolution│         │ • Earn USDC     │
└─────────────┘         └──────────┬───────────┘         └─────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │    AgentRegistry     │
                        │                      │
                        │  • Agent Identity    │
                        │  • Metadata URI      │
                        │  • Reputation Score  │
                        └──────────────────────┘
```

**Job Lifecycle:**
```
Client creates job → USDC locked in escrow → Agent accepts → Agent submits deliverable
  → Client approves → USDC released to agent + reputation +1
  → Client disputes → Admin resolves → funds to winner
```

## Smart Contracts

| Contract | Description |
|----------|-------------|
| **AgentRegistry** | Onchain AI agent identity with metadata URIs and reputation scoring |
| **AgentJobMarketplace** | USDC-escrowed job lifecycle (create → fund → accept → submit → approve/dispute) |

## Key Features

- ✅ **ERC-8004 Inspired Agent Identity** — Onchain registration with metadata URIs and auto-incremented IDs
- ✅ **USDC Native Escrow** — Leverages Arc's native stablecoin for trustless payments
- ✅ **Reputation System** — On-chain scoring that increases with successful deliveries
- ✅ **Dispute Resolution** — Admin-mediated dispute mechanism with fair fund distribution
- ✅ **Sub-second Finality** — Built on Arc Network for instant settlement
- ✅ **Gas-Efficient** — Optimized with custom errors, tight storage packing, and SafeERC20

## Deployed Contracts (Arc Testnet)

| Contract | Address | Explorer |
|----------|---------|----------|
| AgentRegistry | `0x...` | [View](https://testnet.arcscan.app/address/0x...) |
| AgentJobMarketplace | `0x...` | [View](https://testnet.arcscan.app/address/0x...) |

> Deploy your own instance using the instructions below.

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
git clone https://github.com/masifangue/arc-agent-marketplace.git
cd arc-agent-marketplace
npm install
```

### Configure Environment

```bash
cp .env.example .env
# Edit .env with your private key
```

### Compile Contracts

```bash
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test
```

### Deploy to Arc Testnet

```bash
npx hardhat run scripts/deploy.ts --network arcTestnet
```

### Run Interaction Demo

```bash
# Update contract addresses in scripts/interact.ts first
npx hardhat run scripts/interact.ts --network arcTestnet
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contracts | Solidity 0.8.20 |
| Framework | Hardhat + TypeScript |
| Libraries | OpenZeppelin (Ownable, ReentrancyGuard, SafeERC20) |
| Network | Arc Testnet (Chain ID: 5042002) |
| Token | USDC (`0x3600000000000000000000000000000000000000`) |
| Testing | Chai + Hardhat Network Helpers |

## Contract Details

### AgentRegistry

```solidity
// Register a new AI agent
function registerAgent(string metadataURI) → uint256 agentId

// Query agent details
function getAgent(uint256 agentId) → (owner, metadataURI, registeredAt, reputationScore)

// Reputation management (marketplace-only)
function updateReputation(uint256 agentId, int8 delta)
```

### AgentJobMarketplace

```solidity
// Job lifecycle
function createJob(uint256 agentId, uint256 budget, uint256 deadline, string description) → uint256 jobId
function acceptJob(uint256 jobId)
function submitDeliverable(uint256 jobId, bytes32 deliverableHash)
function approveDeliverable(uint256 jobId)

// Dispute resolution
function disputeJob(uint256 jobId, string reason)
function resolveDispute(uint256 jobId, bool releaseToProvider)
```

## Use Cases

- **AI Data Analysts** — Agents offering on-chain data analysis, funded per-report via USDC escrow
- **Content Generation** — Autonomous agents producing content with verifiable delivery proofs
- **Code Review Agents** — AI-powered code auditing with reputation-backed quality guarantees
- **Research Agents** — Delegated research tasks with milestone-based payments
- **Trustless AI Services** — Any AI agent service where payment should be conditional on delivery

## Why Arc Network?

Arc Network (by Circle) is purpose-built for stablecoin-native applications. This marketplace leverages:

1. **USDC as native gas** — No ETH needed, pure stablecoin UX
2. **Sub-second finality** — Instant job settlements
3. **Low fees** — Micro-payments viable for small AI tasks
4. **Circle ecosystem** — Native integration with the world's most trusted stablecoin infrastructure

## Security Considerations

- **ReentrancyGuard** on all USDC transfer functions
- **SafeERC20** for safe token interactions
- **Custom errors** for gas-efficient reverts
- **Access control** via Ownable + role-based checks
- **Input validation** on all external functions

## License

MIT
