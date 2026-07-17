import pkgHardhat from "hardhat";
const { ethers } = pkgHardhat;
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("🚀 Starting deployment of ZaoSettlement contract...");

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    console.error("❌ Error: No deployer accounts configured. Please check your Hardhat configuration.");
    process.exit(1);
  }
  
  const deployer = signers[0];
  console.log(`Deployer address: ${deployer.address}`);
  
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  // ZAO Authority is the address signing the payouts (usually game server public key)
  const zaoAuthority = process.env.ZAO_AUTHORITY_ADDRESS;
  if (!zaoAuthority) {
    console.error("❌ Error: ZAO_AUTHORITY_ADDRESS environment variable is not defined.");
    console.log("Please define it in your .env or .env.local file.");
    process.exit(1);
  }

  if (!ethers.isAddress(zaoAuthority)) {
    console.error(`❌ Error: ZAO_AUTHORITY_ADDRESS "${zaoAuthority}" is not a valid Ethereum address.`);
    process.exit(1);
  }

  console.log(`Using ZAO Authority: ${zaoAuthority}`);

  // Deploy contract
  const ZaoSettlement = await ethers.getContractFactory("ZaoSettlement");
  const zaoSettlement = await ZaoSettlement.deploy(zaoAuthority);

  console.log("Deploying contract...");
  await zaoSettlement.waitForDeployment();

  const contractAddress = await zaoSettlement.getAddress();
  console.log(`\n✅ ZaoSettlement deployed successfully!`);
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Transaction Hash: ${zaoSettlement.deploymentTransaction()?.hash}`);

  // Print verification instructions
  console.log("\nTo verify this contract on-chain, run:");
  console.log(`npx hardhat verify --network ${process.env.HARDHAT_NETWORK || "baseSepolia"} ${contractAddress} "${zaoAuthority}"`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
