import { ethers } from "hardhat";

/**
 * Deploy script for Arc Agent Marketplace contracts.
 * Deploys AgentRegistry → DisputeResolver → AgentBadge → AgentJobMarketplace → links them together.
 *
 * Usage: npx hardhat run scripts/deploy.ts --network arcTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🤖 Arc Agent Marketplace — Deployment");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Network:  ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log("───────────────────────────────────────────────────────────");

  // Arc Testnet token addresses
  const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
  const EURC_ADDRESS = "0x808456652FdB597867e3ee02ed93E6A5E1C3d90c";

  // 1. Deploy AgentRegistry
  console.log("\n📋 Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.waitForDeployment();
  const registryAddress = await agentRegistry.getAddress();
  console.log(`   ✅ AgentRegistry deployed at: ${registryAddress}`);

  // 2. Deploy DisputeResolver
  console.log("\n⚖️  Deploying DisputeResolver...");
  const DisputeResolver = await ethers.getContractFactory("DisputeResolver");
  const disputeResolver = await DisputeResolver.deploy(registryAddress);
  await disputeResolver.waitForDeployment();
  const disputeResolverAddress = await disputeResolver.getAddress();
  console.log(`   ✅ DisputeResolver deployed at: ${disputeResolverAddress}`);

  // 3. Deploy AgentBadge
  console.log("\n🏅 Deploying AgentBadge...");
  const AgentBadge = await ethers.getContractFactory("AgentBadge");
  const agentBadge = await AgentBadge.deploy();
  await agentBadge.waitForDeployment();
  const agentBadgeAddress = await agentBadge.getAddress();
  console.log(`   ✅ AgentBadge deployed at: ${agentBadgeAddress}`);

  // 4. Deploy AgentJobMarketplace
  console.log("\n💼 Deploying AgentJobMarketplace...");
  const AgentJobMarketplace = await ethers.getContractFactory("AgentJobMarketplace");
  const marketplace = await AgentJobMarketplace.deploy(registryAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log(`   ✅ AgentJobMarketplace deployed at: ${marketplaceAddress}`);

  // 5. Link contracts together
  console.log("\n🔗 Linking contracts...");

  // Set marketplace as authorized reputation updater
  let tx = await agentRegistry.setAuthorizedUpdater(marketplaceAddress);
  await tx.wait();
  console.log(`   ✅ Marketplace set as authorized reputation updater`);

  // Set DisputeResolver on marketplace
  tx = await marketplace.setDisputeResolver(disputeResolverAddress);
  await tx.wait();
  console.log(`   ✅ DisputeResolver linked to marketplace`);

  // Set AgentBadge on marketplace
  tx = await marketplace.setAgentBadge(agentBadgeAddress);
  await tx.wait();
  console.log(`   ✅ AgentBadge linked to marketplace`);

  // Set marketplace on DisputeResolver
  tx = await disputeResolver.setMarketplace(marketplaceAddress);
  await tx.wait();
  console.log(`   ✅ Marketplace set on DisputeResolver`);

  // Set marketplace on AgentBadge
  tx = await agentBadge.setMarketplace(marketplaceAddress);
  await tx.wait();
  console.log(`   ✅ Marketplace set on AgentBadge`);

  // 6. Whitelist payment tokens
  console.log("\n💰 Whitelisting payment tokens...");

  tx = await marketplace.addAllowedToken(USDC_ADDRESS);
  await tx.wait();
  console.log(`   ✅ USDC whitelisted: ${USDC_ADDRESS}`);

  tx = await marketplace.addAllowedToken(EURC_ADDRESS);
  await tx.wait();
  console.log(`   ✅ EURC whitelisted: ${EURC_ADDRESS}`);

  // Summary
  const explorerBase = "https://testnet.arcscan.app/address";
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  ✅ Deployment Complete!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  AgentRegistry:       ${registryAddress}`);
  console.log(`  DisputeResolver:     ${disputeResolverAddress}`);
  console.log(`  AgentBadge:          ${agentBadgeAddress}`);
  console.log(`  AgentJobMarketplace: ${marketplaceAddress}`);
  console.log(`  USDC (Arc Testnet):  ${USDC_ADDRESS}`);
  console.log(`  EURC (Arc Testnet):  ${EURC_ADDRESS}`);
  console.log("───────────────────────────────────────────────────────────");
  console.log("  Explorer Links:");
  console.log(`  Registry:        ${explorerBase}/${registryAddress}`);
  console.log(`  DisputeResolver: ${explorerBase}/${disputeResolverAddress}`);
  console.log(`  AgentBadge:      ${explorerBase}/${agentBadgeAddress}`);
  console.log(`  Marketplace:     ${explorerBase}/${marketplaceAddress}`);
  console.log("═══════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
