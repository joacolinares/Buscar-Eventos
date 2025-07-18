require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const config = require("./config");

const {
    CONTRACT_ADDRESS,
    EVENT_NAME,
    BLOCK_TIME_SECONDS,
    DAY_IN_SECONDS,
    STORAGE_PATH,
    ABI_PATH,
} = config;

// Setup provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Load ABI
const abi = require(ABI_PATH);

// Contract instance
const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

/**
 * Loads stored event tx hashes from JSON.
 */
function loadStoredHashes() {
    if (!fs.existsSync(STORAGE_PATH)) return new Set();
    const data = JSON.parse(fs.readFileSync(STORAGE_PATH));
    return new Set(data.map((e) => e.transactionHash));
}

/**
 * Appends new event data to the storage JSON file.
 */
function appendEventData(newEvents) {
    const existing = fs.existsSync(STORAGE_PATH)
        ? JSON.parse(fs.readFileSync(STORAGE_PATH))
        : [];

    const updated = [...existing, ...newEvents];
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(updated, null, 2));
}

/**
 * Main polling function
 */
async function pollEvents() {
    try {
        const currentBlock = await provider.getBlockNumber(); //Obtiene el bloque actual
        const blocksPerDay = Math.floor(DAY_IN_SECONDS / BLOCK_TIME_SECONDS);
        const fromBlock = currentBlock - blocksPerDay; //Desde que bloque inicia

        console.log(`[${new Date().toISOString()}] Scanning from block ${fromBlock} to ${currentBlock}...`);

        const storedHashes = loadStoredHashes(); //Obtiene todos los hashes guardados

        // Query events
        const events = await contract.queryFilter( //Obtiene todos los eventos TokensBought creados en las ultimas 24 horas
            contract.filters[EVENT_NAME](),
            fromBlock,
            currentBlock
        );

        const newEvents = [];
        const repeatedHashes = [];

        for (const ev of events) { //Compara si alguno de los eventos obtenidos (mediante hash) no esta dentro de la lista de events.json
            const txHash = ev.transactionHash;

            if (storedHashes.has(txHash)) { //Si esta dentro va al siguiente
                repeatedHashes.push(txHash);
                continue;
            }

            const { buyer, tokenAmount, totalCost, fee, price, projectAddress } = ev.args;


            newEvents.push({
                transactionHash: txHash,
                buyer,
                tokenAmount: tokenAmount.toString(),
                totalCost: totalCost.toString(),
                fee: fee.toString(),
                price: price.toString(),
                projectAddress,
                blockNumber: ev.blockNumber,
                timestamp: (await provider.getBlock(ev.blockNumber)).timestamp,
            });
        }

        if (newEvents.length > 0) { //Nuevo evento no guardado en las ultimas 24 horas
            console.log(`→ ${newEvents.length} new events found.`);
            console.log("New event transaction hashes:");
            newEvents.forEach((e, i) => {
                console.log(`  ${i + 1}. ${e.transactionHash}`);
            });

            appendEventData(newEvents);
        } else { //Nuevo evento guardado en las ultimas 24 horas
            console.log("→ No new events.");
            if (repeatedHashes.length > 0) {
                console.log("Known (repeated) event hashes from last 24h:");
                repeatedHashes.forEach((hash, i) => {
                    console.log(`  ${i + 1}. ${hash}`);
                });
            } else {  //No hubo nuevo evento en las ultimas 24 horas
                console.log("→ No TokensBought events found in the last 24h.");
            }
        }
    } catch (err) {
        console.error("Polling error:", err);
    }
}

// Run every 60 seconds
pollEvents();
setInterval(pollEvents, 60_000);
