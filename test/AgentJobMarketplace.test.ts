import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { AgentRegistry, AgentJobMarketplace, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentJobMarketplace", function () {
  // ─── Fixture ─────────────────────────────────────────────────────────────────

  async function deployFixture() {
    const [owner, client, agentOwner, otherUser] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // Deploy AgentRegistry
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    const registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();

    // Deploy AgentJobMarketplace
    const AgentJobMarketplace = await ethers.getContractFactory("AgentJobMarketplace");
    const marketplace = await AgentJobMarketplace.deploy(
      await usdc.getAddress(),
      await registry.getAddress()
    );
    await marketplace.waitForDeployment();

    // Set marketplace as authorized updater
    await registry.setAuthorizedUpdater(await marketplace.getAddress());

    // Distribute USDC to client for testing
    await usdc.mint(client.address, ethers.parseUnits("10000", 6));

    return { owner, client, agentOwner, otherUser, usdc, registry, marketplace };
  }

  // ─── Helper ──────────────────────────────────────────────────────────────────

  async function registerAgentFixture() {
    const base = await loadFixture(deployFixture);
    const { registry, agentOwner } = base;

    // Register an agent
    const tx = await registry.connect(agentOwner).registerAgent("ipfs://QmTestAgent/metadata.json");
    await tx.wait();

    return { ...base, agentId: 1n };
  }

  async function createJobFixture() {
    const base = await loadFixture(registerAgentFixture);
    const { marketplace, usdc, client, agentId } = base;

    const budget = ethers.parseUnits("100", 6); // 100 USDC
    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    // Approve and create job
    await usdc.connect(client).approve(await marketplace.getAddress(), budget);
    await marketplace.connect(client).createJob(
      agentId,
      budget,
      deadline,
      "Analyze blockchain data and produce a report"
    );

    return { ...base, jobId: 1n, budget, deadline };
  }

  // ─── AgentRegistry Tests ───────────────────────────────────────────────────

  describe("AgentRegistry", function () {
    it("should register an agent and assign auto-incremented ID", async function () {
      const { registry, agentOwner } = await loadFixture(deployFixture);

      const tx = await registry.connect(agentOwner).registerAgent("ipfs://QmAgent1/metadata.json");
      await expect(tx)
        .to.emit(registry, "AgentRegistered")
        .withArgs(1, agentOwner.address, "ipfs://QmAgent1/metadata.json");

      const agent = await registry.getAgent(1);
      expect(agent.owner).to.equal(agentOwner.address);
      expect(agent.metadataURI).to.equal("ipfs://QmAgent1/metadata.json");
      expect(agent.reputationScore).to.equal(0);
    });

    it("should auto-increment agent IDs", async function () {
      const { registry, agentOwner, client } = await loadFixture(deployFixture);

      await registry.connect(agentOwner).registerAgent("ipfs://agent1");
      await registry.connect(client).registerAgent("ipfs://agent2");

      expect((await registry.getAgent(1)).owner).to.equal(agentOwner.address);
      expect((await registry.getAgent(2)).owner).to.equal(client.address);
      expect(await registry.totalAgents()).to.equal(2);
    });

    it("should revert on empty metadata URI", async function () {
      const { registry, agentOwner } = await loadFixture(deployFixture);

      await expect(registry.connect(agentOwner).registerAgent(""))
        .to.be.revertedWithCustomError(registry, "EmptyMetadataURI");
    });

    it("should revert when querying non-existent agent", async function () {
      const { registry } = await loadFixture(deployFixture);

      await expect(registry.getAgent(999))
        .to.be.revertedWithCustomError(registry, "AgentDoesNotExist");
    });

    it("should only allow authorized updater to change reputation", async function () {
      const { registry, agentOwner, otherUser } = await loadFixture(registerAgentFixture);

      await expect(registry.connect(otherUser).updateReputation(1, 1))
        .to.be.revertedWithCustomError(registry, "NotAuthorizedUpdater");
    });

    it("should track agents by owner", async function () {
      const { registry, agentOwner } = await loadFixture(deployFixture);

      await registry.connect(agentOwner).registerAgent("ipfs://agent1");
      await registry.connect(agentOwner).registerAgent("ipfs://agent2");

      const agents = await registry.getAgentsByOwner(agentOwner.address);
      expect(agents.length).to.equal(2);
      expect(agents[0]).to.equal(1);
      expect(agents[1]).to.equal(2);
    });
  });

  // ─── Job Creation Tests ────────────────────────────────────────────────────

  describe("Job Creation", function () {
    it("should create a job and escrow USDC", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      await usdc.connect(client).approve(await marketplace.getAddress(), budget);

      const tx = await marketplace.connect(client).createJob(
        agentId,
        budget,
        deadline,
        "Test job description"
      );

      await expect(tx)
        .to.emit(marketplace, "JobCreated")
        .withArgs(1, agentId, client.address, budget);

      // Verify USDC was transferred to marketplace
      const marketplaceBalance = await usdc.balanceOf(await marketplace.getAddress());
      expect(marketplaceBalance).to.equal(budget);
    });

    it("should revert with zero budget", async function () {
      const { marketplace, client, agentId } = await loadFixture(registerAgentFixture);

      const deadline = Math.floor(Date.now() / 1000) + 86400;

      await expect(
        marketplace.connect(client).createJob(agentId, 0, deadline, "Test")
      ).to.be.revertedWithCustomError(marketplace, "InvalidBudget");
    });

    it("should revert with past deadline", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      await usdc.connect(client).approve(await marketplace.getAddress(), budget);

      await expect(
        marketplace.connect(client).createJob(agentId, budget, 1000, "Test")
      ).to.be.revertedWithCustomError(marketplace, "InvalidDeadline");
    });

    it("should revert with invalid agent ID", async function () {
      const { marketplace, usdc, client, registry } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await usdc.connect(client).approve(await marketplace.getAddress(), budget);

      // ownerOfAgent(999) reverts in the registry before marketplace can check
      await expect(
        marketplace.connect(client).createJob(999, budget, deadline, "Test")
      ).to.be.revertedWithCustomError(registry, "AgentDoesNotExist");
    });

    it("should revert with empty description", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await usdc.connect(client).approve(await marketplace.getAddress(), budget);

      await expect(
        marketplace.connect(client).createJob(agentId, budget, deadline, "")
      ).to.be.revertedWithCustomError(marketplace, "EmptyDescription");
    });
  });

  // ─── Full Lifecycle Tests ──────────────────────────────────────────────────

  describe("Full Job Lifecycle", function () {
    it("should complete full lifecycle: create → accept → submit → approve", async function () {
      const { marketplace, usdc, registry, client, agentOwner, agentId, jobId, budget } =
        await loadFixture(createJobFixture);

      // Accept job
      const acceptTx = await marketplace.connect(agentOwner).acceptJob(jobId);
      await expect(acceptTx).to.emit(marketplace, "JobAccepted").withArgs(jobId, agentId);

      // Submit deliverable
      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("deliverable-v1"));
      const submitTx = await marketplace.connect(agentOwner).submitDeliverable(jobId, deliverableHash);
      await expect(submitTx).to.emit(marketplace, "DeliverableSubmitted").withArgs(jobId, deliverableHash);

      // Record agent owner balance before approval
      const balanceBefore = await usdc.balanceOf(agentOwner.address);

      // Approve deliverable
      const approveTx = await marketplace.connect(client).approveDeliverable(jobId);
      await expect(approveTx).to.emit(marketplace, "JobCompleted").withArgs(jobId, agentId, budget);

      // Verify USDC was released to agent owner
      const balanceAfter = await usdc.balanceOf(agentOwner.address);
      expect(balanceAfter - balanceBefore).to.equal(budget);

      // Verify reputation increased
      const agent = await registry.getAgent(agentId);
      expect(agent.reputationScore).to.equal(1);

      // Verify job status
      const job = await marketplace.getJob(jobId);
      expect(job.status).to.equal(3); // Completed
    });
  });

  // ─── Access Control Tests ──────────────────────────────────────────────────

  describe("Access Control", function () {
    it("should only allow agent owner to accept job", async function () {
      const { marketplace, client, otherUser, jobId } = await loadFixture(createJobFixture);

      await expect(marketplace.connect(client).acceptJob(jobId))
        .to.be.revertedWithCustomError(marketplace, "NotAgentOwner");

      await expect(marketplace.connect(otherUser).acceptJob(jobId))
        .to.be.revertedWithCustomError(marketplace, "NotAgentOwner");
    });

    it("should only allow agent owner to submit deliverable", async function () {
      const { marketplace, agentOwner, client, otherUser, jobId } = await loadFixture(createJobFixture);

      await marketplace.connect(agentOwner).acceptJob(jobId);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(marketplace.connect(client).submitDeliverable(jobId, hash))
        .to.be.revertedWithCustomError(marketplace, "NotAgentOwner");

      await expect(marketplace.connect(otherUser).submitDeliverable(jobId, hash))
        .to.be.revertedWithCustomError(marketplace, "NotAgentOwner");
    });

    it("should only allow client to approve deliverable", async function () {
      const { marketplace, agentOwner, otherUser, jobId } = await loadFixture(createJobFixture);

      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);

      await expect(marketplace.connect(agentOwner).approveDeliverable(jobId))
        .to.be.revertedWithCustomError(marketplace, "NotClient");

      await expect(marketplace.connect(otherUser).approveDeliverable(jobId))
        .to.be.revertedWithCustomError(marketplace, "NotClient");
    });

    it("should only allow client to dispute", async function () {
      const { marketplace, agentOwner, otherUser, jobId } = await loadFixture(createJobFixture);

      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);

      await expect(marketplace.connect(agentOwner).disputeJob(jobId, "bad work"))
        .to.be.revertedWithCustomError(marketplace, "NotClient");

      await expect(marketplace.connect(otherUser).disputeJob(jobId, "bad work"))
        .to.be.revertedWithCustomError(marketplace, "NotClient");
    });

    it("should only allow owner to resolve disputes", async function () {
      const { marketplace, agentOwner, client, otherUser, jobId } = await loadFixture(createJobFixture);

      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Not satisfied");

      await expect(marketplace.connect(client).resolveDispute(jobId, true))
        .to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");

      await expect(marketplace.connect(otherUser).resolveDispute(jobId, true))
        .to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Dispute Flow Tests ────────────────────────────────────────────────────

  describe("Dispute Flow", function () {
    it("should handle dispute resolved in favor of provider", async function () {
      const { marketplace, usdc, registry, owner, agentOwner, client, agentId, jobId, budget } =
        await loadFixture(createJobFixture);

      // Progress to submitted
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);

      // Client disputes
      const disputeTx = await marketplace.connect(client).disputeJob(jobId, "Quality issues");
      await expect(disputeTx).to.emit(marketplace, "JobDisputed").withArgs(jobId, "Quality issues");

      // Admin resolves in favor of provider
      const balanceBefore = await usdc.balanceOf(agentOwner.address);
      const resolveTx = await marketplace.connect(owner).resolveDispute(jobId, true);
      await expect(resolveTx).to.emit(marketplace, "DisputeResolved").withArgs(jobId, true);

      // Verify payment released to agent
      const balanceAfter = await usdc.balanceOf(agentOwner.address);
      expect(balanceAfter - balanceBefore).to.equal(budget);

      // Verify reputation +1
      const agent = await registry.getAgent(agentId);
      expect(agent.reputationScore).to.equal(1);
    });

    it("should handle dispute resolved in favor of client (refund)", async function () {
      const { marketplace, usdc, registry, owner, agentOwner, client, agentId, jobId, budget } =
        await loadFixture(createJobFixture);

      // Progress to submitted
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);

      // Client disputes
      await marketplace.connect(client).disputeJob(jobId, "Completely wrong output");

      // Admin resolves in favor of client
      const balanceBefore = await usdc.balanceOf(client.address);
      await marketplace.connect(owner).resolveDispute(jobId, false);

      // Verify refund to client
      const balanceAfter = await usdc.balanceOf(client.address);
      expect(balanceAfter - balanceBefore).to.equal(budget);

      // Verify reputation -1
      const agent = await registry.getAgent(agentId);
      expect(agent.reputationScore).to.equal(-1);
    });
  });

  // ─── Status Transition Tests ───────────────────────────────────────────────

  describe("Status Transitions", function () {
    it("should not allow accepting a non-Open job", async function () {
      const { marketplace, agentOwner, jobId } = await loadFixture(createJobFixture);

      await marketplace.connect(agentOwner).acceptJob(jobId);

      // Try accepting again (now InProgress)
      await expect(marketplace.connect(agentOwner).acceptJob(jobId))
        .to.be.revertedWithCustomError(marketplace, "InvalidJobStatus");
    });

    it("should not allow submitting for a non-InProgress job", async function () {
      const { marketplace, agentOwner, jobId } = await loadFixture(createJobFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));

      // Try submitting before accepting (still Open)
      await expect(marketplace.connect(agentOwner).submitDeliverable(jobId, hash))
        .to.be.revertedWithCustomError(marketplace, "InvalidJobStatus");
    });

    it("should not allow approving a non-Submitted job", async function () {
      const { marketplace, agentOwner, client, jobId } = await loadFixture(createJobFixture);

      await marketplace.connect(agentOwner).acceptJob(jobId);

      // Try approving before submission (still InProgress)
      await expect(marketplace.connect(client).approveDeliverable(jobId))
        .to.be.revertedWithCustomError(marketplace, "InvalidJobStatus");
    });

    it("should not allow disputing a non-Submitted job", async function () {
      const { marketplace, agentOwner, client, jobId } = await loadFixture(createJobFixture);

      await marketplace.connect(agentOwner).acceptJob(jobId);

      // Try disputing before submission
      await expect(marketplace.connect(client).disputeJob(jobId, "reason"))
        .to.be.revertedWithCustomError(marketplace, "InvalidJobStatus");
    });
  });

  // ─── View Function Tests ───────────────────────────────────────────────────

  describe("View Functions", function () {
    it("should return correct job details", async function () {
      const { marketplace, client, agentId, jobId, budget } = await loadFixture(createJobFixture);

      const job = await marketplace.getJob(jobId);
      expect(job.jobId).to.equal(jobId);
      expect(job.agentId).to.equal(agentId);
      expect(job.client).to.equal(client.address);
      expect(job.budget).to.equal(budget);
      expect(job.status).to.equal(0); // Open
      expect(job.description).to.equal("Analyze blockchain data and produce a report");
    });

    it("should track jobs by client", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("10", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      // Create 2 jobs
      await usdc.connect(client).approve(await marketplace.getAddress(), budget * 2n);
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 1");
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 2");

      const jobs = await marketplace.getJobsByClient(client.address);
      expect(jobs.length).to.equal(2);
    });

    it("should track jobs by agent", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("10", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      await usdc.connect(client).approve(await marketplace.getAddress(), budget * 2n);
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 1");
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 2");

      const jobs = await marketplace.getJobsByAgent(agentId);
      expect(jobs.length).to.equal(2);
    });

    it("should revert when querying non-existent job", async function () {
      const { marketplace } = await loadFixture(deployFixture);

      await expect(marketplace.getJob(999))
        .to.be.revertedWithCustomError(marketplace, "JobNotFound");
    });

    it("should return total jobs count", async function () {
      const { marketplace } = await loadFixture(createJobFixture);
      expect(await marketplace.totalJobs()).to.equal(1);
    });
  });
});
