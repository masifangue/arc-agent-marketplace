import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { AgentRegistry, AgentJobMarketplace, AgentBadge, DisputeResolver, MockUSDC, MockEURC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentJobMarketplace", function () {
  // ─── Fixture ─────────────────────────────────────────────────────────────────

  async function deployFixture() {
    const [owner, client, agentOwner, otherUser, voter1, voter2, voter3] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // Deploy MockEURC
    const MockEURC = await ethers.getContractFactory("MockEURC");
    const eurc = await MockEURC.deploy();
    await eurc.waitForDeployment();

    // Deploy AgentRegistry
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    const registry = await AgentRegistry.deploy();
    await registry.waitForDeployment();

    // Deploy DisputeResolver
    const DisputeResolver = await ethers.getContractFactory("DisputeResolver");
    const disputeResolver = await DisputeResolver.deploy(await registry.getAddress());
    await disputeResolver.waitForDeployment();

    // Deploy AgentBadge
    const AgentBadge = await ethers.getContractFactory("AgentBadge");
    const agentBadge = await AgentBadge.deploy();
    await agentBadge.waitForDeployment();

    // Deploy AgentJobMarketplace
    const AgentJobMarketplace = await ethers.getContractFactory("AgentJobMarketplace");
    const marketplace = await AgentJobMarketplace.deploy(
      await registry.getAddress()
    );
    await marketplace.waitForDeployment();

    // Link contracts
    await registry.setAuthorizedUpdater(await marketplace.getAddress());
    await marketplace.setDisputeResolver(await disputeResolver.getAddress());
    await marketplace.setAgentBadge(await agentBadge.getAddress());
    await disputeResolver.setMarketplace(await marketplace.getAddress());
    await agentBadge.setMarketplace(await marketplace.getAddress());

    // Whitelist tokens
    await marketplace.addAllowedToken(await usdc.getAddress());
    await marketplace.addAllowedToken(await eurc.getAddress());

    // Distribute tokens to client for testing
    await usdc.mint(client.address, ethers.parseUnits("10000", 6));
    await eurc.mint(client.address, ethers.parseUnits("10000", 6));

    return { owner, client, agentOwner, otherUser, voter1, voter2, voter3, usdc, eurc, registry, marketplace, disputeResolver, agentBadge };
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
      "Analyze blockchain data and produce a report",
      await usdc.getAddress()
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
        "Test job description",
        await usdc.getAddress()
      );

      await expect(tx)
        .to.emit(marketplace, "JobCreated")
        .withArgs(1, agentId, client.address, budget);

      // Verify USDC was transferred to marketplace
      const marketplaceBalance = await usdc.balanceOf(await marketplace.getAddress());
      expect(marketplaceBalance).to.equal(budget);
    });

    it("should revert with zero budget", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const deadline = Math.floor(Date.now() / 1000) + 86400;

      await expect(
        marketplace.connect(client).createJob(agentId, 0, deadline, "Test", await usdc.getAddress())
      ).to.be.revertedWithCustomError(marketplace, "InvalidBudget");
    });

    it("should revert with past deadline", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      await usdc.connect(client).approve(await marketplace.getAddress(), budget);

      await expect(
        marketplace.connect(client).createJob(agentId, budget, 1000, "Test", await usdc.getAddress())
      ).to.be.revertedWithCustomError(marketplace, "InvalidDeadline");
    });

    it("should revert with invalid agent ID", async function () {
      const { marketplace, usdc, client, registry } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await usdc.connect(client).approve(await marketplace.getAddress(), budget);

      // ownerOfAgent(999) reverts in the registry before marketplace can check
      await expect(
        marketplace.connect(client).createJob(999, budget, deadline, "Test", await usdc.getAddress())
      ).to.be.revertedWithCustomError(registry, "AgentDoesNotExist");
    });

    it("should revert with empty description", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await usdc.connect(client).approve(await marketplace.getAddress(), budget);

      await expect(
        marketplace.connect(client).createJob(agentId, budget, deadline, "", await usdc.getAddress())
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

    it("should only allow owner to resolve disputes (admin)", async function () {
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
      const { marketplace, usdc, client, agentId, jobId, budget } = await loadFixture(createJobFixture);

      const job = await marketplace.getJob(jobId);
      expect(job.jobId).to.equal(jobId);
      expect(job.agentId).to.equal(agentId);
      expect(job.client).to.equal(client.address);
      expect(job.budget).to.equal(budget);
      expect(job.status).to.equal(0); // Open
      expect(job.description).to.equal("Analyze blockchain data and produce a report");
      expect(job.paymentToken).to.equal(await usdc.getAddress());
    });

    it("should track jobs by client", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("10", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      // Create 2 jobs
      await usdc.connect(client).approve(await marketplace.getAddress(), budget * 2n);
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 1", await usdc.getAddress());
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 2", await usdc.getAddress());

      const jobs = await marketplace.getJobsByClient(client.address);
      expect(jobs.length).to.equal(2);
    });

    it("should track jobs by agent", async function () {
      const { marketplace, usdc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("10", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      await usdc.connect(client).approve(await marketplace.getAddress(), budget * 2n);
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 1", await usdc.getAddress());
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 2", await usdc.getAddress());

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

  // ─── Multi-Token Tests ─────────────────────────────────────────────────────

  describe("Multi-Token Support", function () {
    it("should create a job with EURC", async function () {
      const { marketplace, eurc, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("200", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      await eurc.connect(client).approve(await marketplace.getAddress(), budget);

      const tx = await marketplace.connect(client).createJob(
        agentId,
        budget,
        deadline,
        "EURC payment job",
        await eurc.getAddress()
      );

      await expect(tx)
        .to.emit(marketplace, "JobCreated")
        .withArgs(1, agentId, client.address, budget);

      // Verify EURC was transferred to marketplace
      const marketplaceBalance = await eurc.balanceOf(await marketplace.getAddress());
      expect(marketplaceBalance).to.equal(budget);

      // Verify job stores correct payment token
      const job = await marketplace.getJob(1);
      expect(job.paymentToken).to.equal(await eurc.getAddress());
    });

    it("should reject non-whitelisted token", async function () {
      const { marketplace, client, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const fakeToken = "0x0000000000000000000000000000000000000001";

      await expect(
        marketplace.connect(client).createJob(agentId, budget, deadline, "Test", fakeToken)
      ).to.be.revertedWithCustomError(marketplace, "TokenNotAllowed");
    });

    it("should allow owner to add and remove tokens", async function () {
      const { marketplace, owner } = await loadFixture(deployFixture);

      const newToken = "0x0000000000000000000000000000000000000042";

      // Add token
      const addTx = await marketplace.connect(owner).addAllowedToken(newToken);
      await expect(addTx).to.emit(marketplace, "TokenAdded").withArgs(newToken);
      expect(await marketplace.allowedTokens(newToken)).to.be.true;

      // Remove token
      const removeTx = await marketplace.connect(owner).removeAllowedToken(newToken);
      await expect(removeTx).to.emit(marketplace, "TokenRemoved").withArgs(newToken);
      expect(await marketplace.allowedTokens(newToken)).to.be.false;
    });

    it("should revert when adding already-allowed token", async function () {
      const { marketplace, owner, usdc } = await loadFixture(deployFixture);

      await expect(
        marketplace.connect(owner).addAllowedToken(await usdc.getAddress())
      ).to.be.revertedWithCustomError(marketplace, "TokenAlreadyAllowed");
    });

    it("should revert when removing non-allowed token", async function () {
      const { marketplace, owner } = await loadFixture(deployFixture);

      const fakeToken = "0x0000000000000000000000000000000000000099";
      await expect(
        marketplace.connect(owner).removeAllowedToken(fakeToken)
      ).to.be.revertedWithCustomError(marketplace, "TokenNotAllowed");
    });

    it("should complete full lifecycle with EURC payment", async function () {
      const { marketplace, eurc, registry, client, agentOwner, agentId } = await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("150", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      // Create job with EURC
      await eurc.connect(client).approve(await marketplace.getAddress(), budget);
      await marketplace.connect(client).createJob(agentId, budget, deadline, "EURC job", await eurc.getAddress());

      const jobId = 1n;

      // Accept
      await marketplace.connect(agentOwner).acceptJob(jobId);

      // Submit
      const hash = ethers.keccak256(ethers.toUtf8Bytes("eurc-deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);

      // Approve
      const balanceBefore = await eurc.balanceOf(agentOwner.address);
      await marketplace.connect(client).approveDeliverable(jobId);
      const balanceAfter = await eurc.balanceOf(agentOwner.address);

      expect(balanceAfter - balanceBefore).to.equal(budget);
    });

    it("should return all allowed tokens", async function () {
      const { marketplace, usdc, eurc } = await loadFixture(deployFixture);

      const tokens = await marketplace.getAllowedTokens();
      expect(tokens.length).to.equal(2);
      expect(tokens).to.include(await usdc.getAddress());
      expect(tokens).to.include(await eurc.getAddress());
    });
  });

  // ─── Dispute Voting Tests ──────────────────────────────────────────────────

  describe("Dispute Voting", function () {
    it("should open a dispute and allow voting", async function () {
      const { marketplace, disputeResolver, registry, agentOwner, client, voter1, voter2, jobId } =
        await loadFixture(createJobFixture);

      // Register voters as agents
      await registry.connect(voter1).registerAgent("ipfs://voter1");
      await registry.connect(voter2).registerAgent("ipfs://voter2");

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Bad quality");

      // Verify dispute was opened
      const disputeId = await disputeResolver.jobToDispute(jobId);
      expect(disputeId).to.equal(1);

      const dispute = await disputeResolver.getDispute(disputeId);
      expect(dispute.jobId).to.equal(jobId);
      expect(dispute.status).to.equal(0); // Active

      // Vote
      await disputeResolver.connect(voter1).vote(disputeId, true); // for agent
      await disputeResolver.connect(voter2).vote(disputeId, false); // for client

      const disputeAfter = await disputeResolver.getDispute(disputeId);
      expect(disputeAfter.votesForAgent).to.equal(1);
      expect(disputeAfter.votesForClient).to.equal(1);
    });

    it("should resolve dispute via voting in favor of agent", async function () {
      const { marketplace, usdc, disputeResolver, registry, agentOwner, client, voter1, voter2, voter3, agentId, jobId, budget } =
        await loadFixture(createJobFixture);

      // Register voters as agents
      await registry.connect(voter1).registerAgent("ipfs://voter1");
      await registry.connect(voter2).registerAgent("ipfs://voter2");
      await registry.connect(voter3).registerAgent("ipfs://voter3");

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Bad quality");

      const disputeId = await disputeResolver.jobToDispute(jobId);

      // Vote: 2 for agent, 1 for client
      await disputeResolver.connect(voter1).vote(disputeId, true);
      await disputeResolver.connect(voter2).vote(disputeId, true);
      await disputeResolver.connect(voter3).vote(disputeId, false);

      // Advance time past voting period
      await time.increase(6 * 60); // 6 minutes (voting period is 5 min)

      // Resolve via voting
      const balanceBefore = await usdc.balanceOf(agentOwner.address);
      await marketplace.resolveDisputeVoting(jobId);
      const balanceAfter = await usdc.balanceOf(agentOwner.address);

      // Agent should get paid
      expect(balanceAfter - balanceBefore).to.equal(budget);

      // Verify reputation +1
      const agent = await registry.getAgent(agentId);
      expect(agent.reputationScore).to.equal(1);
    });

    it("should resolve dispute via voting in favor of client", async function () {
      const { marketplace, usdc, disputeResolver, registry, agentOwner, client, voter1, voter2, voter3, agentId, jobId, budget } =
        await loadFixture(createJobFixture);

      // Register voters as agents
      await registry.connect(voter1).registerAgent("ipfs://voter1");
      await registry.connect(voter2).registerAgent("ipfs://voter2");
      await registry.connect(voter3).registerAgent("ipfs://voter3");

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Terrible work");

      const disputeId = await disputeResolver.jobToDispute(jobId);

      // Vote: 1 for agent, 2 for client
      await disputeResolver.connect(voter1).vote(disputeId, false);
      await disputeResolver.connect(voter2).vote(disputeId, true);
      await disputeResolver.connect(voter3).vote(disputeId, false);

      // Advance time past voting period
      await time.increase(6 * 60);

      // Resolve via voting
      const balanceBefore = await usdc.balanceOf(client.address);
      await marketplace.resolveDisputeVoting(jobId);
      const balanceAfter = await usdc.balanceOf(client.address);

      // Client should get refund
      expect(balanceAfter - balanceBefore).to.equal(budget);

      // Verify reputation -1
      const agent = await registry.getAgent(agentId);
      expect(agent.reputationScore).to.equal(-1);
    });

    it("should not allow voting after period ends", async function () {
      const { marketplace, disputeResolver, registry, agentOwner, client, voter1, jobId } =
        await loadFixture(createJobFixture);

      await registry.connect(voter1).registerAgent("ipfs://voter1");

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Issue");

      const disputeId = await disputeResolver.jobToDispute(jobId);

      // Advance time past voting period
      await time.increase(6 * 60);

      await expect(disputeResolver.connect(voter1).vote(disputeId, true))
        .to.be.revertedWithCustomError(disputeResolver, "VotingPeriodEnded");
    });

    it("should not allow double voting", async function () {
      const { marketplace, disputeResolver, registry, agentOwner, client, voter1, jobId } =
        await loadFixture(createJobFixture);

      await registry.connect(voter1).registerAgent("ipfs://voter1");

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Issue");

      const disputeId = await disputeResolver.jobToDispute(jobId);

      await disputeResolver.connect(voter1).vote(disputeId, true);

      await expect(disputeResolver.connect(voter1).vote(disputeId, false))
        .to.be.revertedWithCustomError(disputeResolver, "AlreadyVoted");
    });

    it("should not allow non-registered agents to vote", async function () {
      const { marketplace, disputeResolver, agentOwner, client, otherUser, jobId } =
        await loadFixture(createJobFixture);

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Issue");

      const disputeId = await disputeResolver.jobToDispute(jobId);

      // otherUser is not a registered agent
      await expect(disputeResolver.connect(otherUser).vote(disputeId, true))
        .to.be.revertedWithCustomError(disputeResolver, "NotRegisteredAgent");
    });

    it("should not resolve before voting period ends", async function () {
      const { marketplace, disputeResolver, registry, agentOwner, client, voter1, jobId } =
        await loadFixture(createJobFixture);

      await registry.connect(voter1).registerAgent("ipfs://voter1");

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Issue");

      const disputeId = await disputeResolver.jobToDispute(jobId);
      await disputeResolver.connect(voter1).vote(disputeId, true);

      // Try to resolve before period ends
      await expect(disputeResolver.resolveDispute(disputeId))
        .to.be.revertedWithCustomError(disputeResolver, "VotingPeriodNotEnded");
    });
  });

  // ─── NFT Badge Tests ───────────────────────────────────────────────────────

  describe("NFT Badges", function () {
    it("should mint badge on job completion", async function () {
      const { marketplace, usdc, agentBadge, agentOwner, client, agentId, jobId, budget } =
        await loadFixture(createJobFixture);

      // Complete the job
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);

      const tx = await marketplace.connect(client).approveDeliverable(jobId);
      await expect(tx).to.emit(agentBadge, "BadgeMinted").withArgs(1, agentOwner.address, jobId);

      // Verify badge count
      expect(await agentBadge.badgeCount(agentOwner.address)).to.equal(1);

      // Verify badge ownership
      expect(await agentBadge.ownerOf(1)).to.equal(agentOwner.address);
    });

    it("should store correct badge metadata", async function () {
      const { marketplace, usdc, agentBadge, agentOwner, client, jobId, budget } =
        await loadFixture(createJobFixture);

      // Complete the job
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).approveDeliverable(jobId);

      // Check metadata
      const metadata = await agentBadge.getBadgeMetadata(1);
      expect(metadata.jobId).to.equal(jobId);
      expect(metadata.paymentAmount).to.equal(budget);
      expect(metadata.tokenUsed).to.equal(await usdc.getAddress());
      expect(metadata.completionTimestamp).to.be.gt(0);
    });

    it("should increment badge count for multiple completions", async function () {
      const { marketplace, usdc, agentBadge, registry, agentOwner, client, agentId } =
        await loadFixture(registerAgentFixture);

      const budget = ethers.parseUnits("50", 6);
      const deadline = Math.floor(Date.now() / 1000) + 86400;

      // Create and complete 2 jobs
      await usdc.connect(client).approve(await marketplace.getAddress(), budget * 2n);

      // Job 1
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 1", await usdc.getAddress());
      await marketplace.connect(agentOwner).acceptJob(1);
      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("d1"));
      await marketplace.connect(agentOwner).submitDeliverable(1, hash1);
      await marketplace.connect(client).approveDeliverable(1);

      // Job 2
      await marketplace.connect(client).createJob(agentId, budget, deadline, "Job 2", await usdc.getAddress());
      await marketplace.connect(agentOwner).acceptJob(2);
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("d2"));
      await marketplace.connect(agentOwner).submitDeliverable(2, hash2);
      await marketplace.connect(client).approveDeliverable(2);

      expect(await agentBadge.badgeCount(agentOwner.address)).to.equal(2);
      expect(await agentBadge.totalBadges()).to.equal(2);
    });

    it("should only allow marketplace to mint badges", async function () {
      const { agentBadge, usdc, otherUser } = await loadFixture(deployFixture);

      await expect(
        agentBadge.connect(otherUser).mintBadge(otherUser.address, 1, 100, await usdc.getAddress())
      ).to.be.revertedWithCustomError(agentBadge, "NotMarketplace");
    });

    it("should mint badge on dispute resolved in favor of agent", async function () {
      const { marketplace, usdc, agentBadge, disputeResolver, registry, agentOwner, client, voter1, voter2, agentId, jobId, budget } =
        await loadFixture(createJobFixture);

      // Register voters
      await registry.connect(voter1).registerAgent("ipfs://voter1");
      await registry.connect(voter2).registerAgent("ipfs://voter2");

      // Progress to disputed
      await marketplace.connect(agentOwner).acceptJob(jobId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));
      await marketplace.connect(agentOwner).submitDeliverable(jobId, hash);
      await marketplace.connect(client).disputeJob(jobId, "Issue");

      const disputeId = await disputeResolver.jobToDispute(jobId);

      // Vote in favor of agent
      await disputeResolver.connect(voter1).vote(disputeId, true);
      await disputeResolver.connect(voter2).vote(disputeId, true);

      // Advance time
      await time.increase(6 * 60);

      // Resolve - agent wins, should get badge
      await marketplace.resolveDisputeVoting(jobId);

      expect(await agentBadge.badgeCount(agentOwner.address)).to.equal(1);
    });
  });
});
