import { ethers } from "hardhat";

/**
 * Deploy script for Arc Agent Marketplace contracts.
 * Deploys AgentRegistry → AgentJobMarketplace → links them together.
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

  // Arc Testnet USDC address
  const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

  // 1. Deploy AgentRegistry
  console.log("\n📋 Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.waitForDeployment();
  const registryAddress = await agentRegistry.getAddress();
  console.log(`   ✅ AgentRegistry deployed at: ${registryAddress}`);

  // 2. Deploy AgentJobMarketplace
  console.log("\n💼 Deploying AgentJobMarketplace...");
  const AgentJobMarketplace = await ethers.getContractFactory("AgentJobMarketplace");
  const marketplace = await AgentJobMarketplace.deploy(USDC_ADDRESS, registryAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log(`   ✅ AgentJobMarketplace deployed at: ${marketplaceAddress}`);

  // 3. Set marketplace as authorized reputation updater
  console.log("\n🔗 Linking contracts...");
  const tx = await agentRegistry.setAuthorizedUpdater(marketplaceAddress);
  await tx.wait();
  console.log(`   ✅ Marketplace set as authorized reputation updater`);

  // Summary
  const explorerBase = "https://testnet.arcscan.app/address";
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  ✅ Deployment Complete!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  AgentRegistry:       ${registryAddress}`);
  console.log(`  AgentJobMarketplace: ${marketplaceAddress}`);
  console.log(`  USDC (Arc Testnet):  ${USDC_ADDRESS}`);
  console.log("───────────────────────────────────────────────────────────");
  console.log("  Explorer Links:");
  console.log(`  Registry:    ${explorerBase}/${registryAddress}`);
  console.log(`  Marketplace: ${explorerBase}/${marketplaceAddress}`);
  console.log("═══════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
