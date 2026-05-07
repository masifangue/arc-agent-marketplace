import { ethers } from "hardhat";

/**
 * Interaction script demonstrating the full job lifecycle on Arc Agent Marketplace.
 *
 * Flow: Register Agent → Create Job → Accept → Submit → Approve
 *
 * Usage: npx hardhat run scripts/interact.ts --network arcTestnet
 *
 * NOTE: Update the contract addresses below after deployment.
 */

// ─── UPDATE THESE AFTER DEPLOYMENT ───────────────────────────────────────────
const REGISTRY_ADDRESS = "0x0000000000000000000000000000000000000000"; // Replace after deploy
const MARKETPLACE_ADDRESS = "0x0000000000000000000000000000000000000000"; // Replace after deploy
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const explorerBase = "https://testnet.arcscan.app/tx";

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🤖 Arc Agent Marketplace — Interaction Demo");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Signer: ${deployer.address}`);
  console.log("───────────────────────────────────────────────────────────");

  // Connect to deployed contracts
  const registry = await ethers.getContractAt("AgentRegistry", REGISTRY_ADDRESS);
  const marketplace = await ethers.getContractAt("AgentJobMarketplace", MARKETPLACE_ADDRESS);
  const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);

  // ─── Step 1: Register an AI Agent ──────────────────────────────────────────
  console.log("\n📋 Step 1: Registering AI Agent...");
  const metadataURI = "ipfs://QmExampleHash/agent-metadata.json";
  const registerTx = await registry.registerAgent(metadataURI);
  const registerReceipt = await registerTx.wait();
  console.log(`   ✅ Agent registered!`);
  console.log(`   TX: ${explorerBase}/${registerTx.hash}`);

  // Get the agent ID from the event
  const registerEvent = registerReceipt?.logs[0];
  const agentId = 1; // First agent
  console.log(`   Agent ID: ${agentId}`);

  // ─── Step 2: Create a Job (5 USDC) ────────────────────────────────────────
  console.log("\n💼 Step 2: Creating job with 5 USDC budget...");
  const budget = ethers.parseUnits("5", 6); // USDC has 6 decimals
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days from now
  const description = "Analyze on-chain data and generate a weekly DeFi report for Arc Network";

  // Approve USDC spending
  console.log("   Approving USDC...");
  const approveTx = await usdc.approve(MARKETPLACE_ADDRESS, budget);
  await approveTx.wait();
  console.log(`   ✅ USDC approved`);
  console.log(`   TX: ${explorerBase}/${approveTx.hash}`);

  // Create the job
  const createJobTx = await marketplace.createJob(agentId, budget, deadline, description);
  await createJobTx.wait();
  const jobId = 1; // First job
  console.log(`   ✅ Job created!`);
  console.log(`   TX: ${explorerBase}/${createJobTx.hash}`);
  console.log(`   Job ID: ${jobId}`);

  // ─── Step 3: Accept the Job ────────────────────────────────────────────────
  console.log("\n🤝 Step 3: Agent accepting job...");
  const acceptTx = await marketplace.acceptJob(jobId);
  await acceptTx.wait();
  console.log(`   ✅ Job accepted!`);
  console.log(`   TX: ${explorerBase}/${acceptTx.hash}`);

  // ─── Step 4: Submit Deliverable ────────────────────────────────────────────
  console.log("\n📦 Step 4: Submitting deliverable...");
  const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("ipfs://QmDeliverableHash/report.pdf"));
  const submitTx = await marketplace.submitDeliverable(jobId, deliverableHash);
  await submitTx.wait();
  console.log(`   ✅ Deliverable submitted!`);
  console.log(`   TX: ${explorerBase}/${submitTx.hash}`);
  console.log(`   Hash: ${deliverableHash}`);

  // ─── Step 5: Approve & Complete ────────────────────────────────────────────
  console.log("\n✅ Step 5: Client approving deliverable...");
  const approvDeliverableTx = await marketplace.approveDeliverable(jobId);
  await approvDeliverableTx.wait();
  console.log(`   ✅ Job completed! USDC released to agent.`);
  console.log(`   TX: ${explorerBase}/${approvDeliverableTx.hash}`);

  // ─── Final State ───────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  ✅ Full Lifecycle Complete!");
  console.log("═══════════════════════════════════════════════════════════");

  const agentData = await registry.getAgent(agentId);
  console.log(`  Agent Reputation: ${agentData.reputationScore}`);

  const jobData = await marketplace.getJob(jobId);
  console.log(`  Job Status: Completed`);
  console.log(`  Budget: ${ethers.formatUnits(jobData.budget, 6)} USDC`);
  console.log("═══════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Interaction failed:", error);
    process.exit(1);
  });
