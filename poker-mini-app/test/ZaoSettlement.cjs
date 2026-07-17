/* eslint-disable */
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ZaoSettlement", function () {
  async function deployFixture() {
    const [owner, authority, player, otherAccount] = await ethers.getSigners();

    const ZaoSettlement = await ethers.getContractFactory("ZaoSettlement");
    const zaoSettlement = await ZaoSettlement.deploy(authority.address);

    return { zaoSettlement, owner, authority, player, otherAccount };
  }

  describe("Deployment", function () {
    it("Should set the right ZAO authority", async function () {
      const { zaoSettlement, authority } = await deployFixture();
      expect(await zaoSettlement.zaoAuthority()).to.equal(authority.address);
    });

    it("Should set the right owner", async function () {
      const { zaoSettlement, owner } = await deployFixture();
      expect(await zaoSettlement.owner()).to.equal(owner.address);
    });
  });

  describe("Claiming Payouts", function () {
    it("Should verify EIP-712 signatures and release payouts", async function () {
      const { zaoSettlement, authority, player } = await deployFixture();

      // Fund the contract with ETH
      const depositAmount = ethers.parseEther("1.0");
      await zaoSettlement.deposit(ethers.ZeroAddress, 0, { value: depositAmount });

      // Check contract balance
      expect(await ethers.provider.getBalance(await zaoSettlement.getAddress())).to.equal(depositAmount);

      const claimAmount = ethers.parseEther("0.1");
      const nonce = 1;
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // EIP-712 Domain
      const domain = {
        name: "ZaoSettlement",
        version: "1",
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        verifyingContract: await zaoSettlement.getAddress(),
      };

      // EIP-712 Types
      const types = {
        PayoutClaim: [
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      // EIP-712 Value
      const value = {
        recipient: player.address,
        token: ethers.ZeroAddress,
        amount: claimAmount,
        nonce: nonce,
        deadline: deadline,
      };

      // Sign typed data using the ZAO Authority signer
      const signature = await authority.signTypedData(domain, types, value);

      // Submit claim as the player
      const initialPlayerBalance = await ethers.provider.getBalance(player.address);

      const claimTx = await zaoSettlement.connect(player).claim(
        player.address,
        ethers.ZeroAddress,
        claimAmount,
        nonce,
        deadline,
        signature
      );

      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt ? claimReceipt.gasUsed * claimReceipt.gasPrice : 0n;

      // Check balances
      const finalPlayerBalance = await ethers.provider.getBalance(player.address);
      expect(finalPlayerBalance).to.equal(initialPlayerBalance + claimAmount - gasUsed);

      // Check nonce is marked as used
      expect(await zaoSettlement.usedNonces(player.address, nonce)).to.be.true;
    });

    it("Should reject claims with expired deadlines", async function () {
      const { zaoSettlement, authority, player } = await deployFixture();
      const claimAmount = ethers.parseEther("0.1");
      const nonce = 1;
      const deadline = Math.floor(Date.now() / 1000) - 3600; // Expired 1 hour ago

      const domain = {
        name: "ZaoSettlement",
        version: "1",
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        verifyingContract: await zaoSettlement.getAddress(),
      };

      const types = {
        PayoutClaim: [
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        recipient: player.address,
        token: ethers.ZeroAddress,
        amount: claimAmount,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await authority.signTypedData(domain, types, value);

      await expect(
        zaoSettlement.connect(player).claim(
          player.address,
          ethers.ZeroAddress,
          claimAmount,
          nonce,
          deadline,
          signature
        )
      ).to.be.revertedWith("Claim signature expired");
    });

    it("Should reject replay attacks (reusing nonce)", async function () {
      const { zaoSettlement, authority, player } = await deployFixture();

      // Fund the contract
      await zaoSettlement.deposit(ethers.ZeroAddress, 0, { value: ethers.parseEther("1.0") });

      const claimAmount = ethers.parseEther("0.1");
      const nonce = 1;
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const domain = {
        name: "ZaoSettlement",
        version: "1",
        chainId: Number((await ethers.provider.getNetwork()).chainId),
        verifyingContract: await zaoSettlement.getAddress(),
      };

      const types = {
        PayoutClaim: [
          { name: "recipient", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        recipient: player.address,
        token: ethers.ZeroAddress,
        amount: claimAmount,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await authority.signTypedData(domain, types, value);

      // Claim successfully first time
      await zaoSettlement.connect(player).claim(
        player.address,
        ethers.ZeroAddress,
        claimAmount,
        nonce,
        deadline,
        signature
      );

      // Attempt to claim second time with same signature and nonce
      await expect(
        zaoSettlement.connect(player).claim(
          player.address,
          ethers.ZeroAddress,
          claimAmount,
          nonce,
          deadline,
          signature
        )
      ).to.be.revertedWith("Nonce already used");
    });
  });
});
