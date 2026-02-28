require('dotenv').config();
require('../database/mongoose'); // Connects to MongoDB
const User = require('../models/User');
const axios = require('axios');

const FOCUS8_BASE_URL = process.env.FOCUS8_BASE_URL;
const FOCUS8_USERNAME = process.env.FOCUS8_USERNAME;
const FOCUS8_PASSWORD = process.env.FOCUS8_PASSWORD;
const FOCUS8_COMPANY_CODE = process.env.FOCUS8_COMPANY_CODE;

async function loginToFocus8() {
    const res = await axios.post(`${FOCUS8_BASE_URL}/login`, {
        url: null,
        data: [{
            UserName: FOCUS8_USERNAME,
            Password: FOCUS8_PASSWORD,
            CompanyCode: FOCUS8_COMPANY_CODE
        }]
    });
    return res.data.data[0].fSessionId;
}

async function syncAccounts() {
    try {
        console.log("Connected to DB");

        const session = await loginToFocus8();
        console.log("Logged into Focus8");

        // Optimized Focus8 Query
        const query = `SELECT iMasterId, sName, sCode, sTelNo FROM vmCore_Account WHERE istatus <> 5 AND iAccountType = 5 AND sCode LIKE 'D%' AND LEN(sCode) = 12 AND sTelNo != ''`;
        
        console.log("Fetching filtered Dealers directly from Focus8...");
        const res = await axios.post(`${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`, {
            data: [{ Query: query }]
        }, { headers: { fSessionId: session } });

        const focusDealers = res.data?.data?.[0]?.Table || [];
        console.log(`Total filtered Dealers fetched from Focus8: ${focusDealers.length}`);

        // Get existing Dealer users for dealer code comparison
        const dbDealers = await User.find({ accountType: 'Dealer' });
        const dbDealersWithCode = new Set(dbDealers.filter(u => u.dealerCode).map(u => u.dealerCode.trim().toLowerCase()));

        // Get ALL users to check for mobile conflicts (since unique index is global)
        const allUsers = await User.find({}, { mobile: 1 });
        const existingMobiles = new Set(allUsers.filter(u => u.mobile).map(u => u.mobile.trim()));

        let toAddAccounts = [];
        
        for (const account of focusDealers) {
            const sCode = account.sCode ? account.sCode.trim() : null;
            if (!sCode) continue;

            const sCodeLower = sCode.toLowerCase();

            // We only add if the dealerCode is NOT already in MongoDB
            if (!dbDealersWithCode.has(sCodeLower)) {
                toAddAccounts.push(account);
            }
        }

        console.log(`Accounts to be created in MongoDB (Missing from DB): ${toAddAccounts.length}`);

        let successCount = 0;
        let failCount = 0;
        let newlyAddedMobiles = new Set();
        let conflictsDuplicatedCount = 0;

        const dataToInsert = [];

        for (const acc of toAddAccounts) {
            const sCode = acc.sCode.trim();
            const originalMobile = acc.sTelNo.trim();
            
            let mobileToSave = originalMobile;

            // Handle Duplicate Mobile in DB or within the new batch
            if (existingMobiles.has(mobileToSave) || newlyAddedMobiles.has(mobileToSave)) {
                mobileToSave = `DUP_${mobileToSave}_${sCode}`;
                conflictsDuplicatedCount++;
            }

            // Record this mobile to prevent duplicates within this batch
            newlyAddedMobiles.add(mobileToSave);

            dataToInsert.push({
                name: acc.sName ? acc.sName.trim() : 'Unknown Name',
                mobile: mobileToSave,
                dealerCode: sCode,
                accountType: 'Dealer',
                status: 'active'
            });
        }

        console.log(`Mobile conflicts avoided (Appended DUP_ prefix): ${conflictsDuplicatedCount}`);
        
        if (dataToInsert.length === 0) {
            console.log('--- No new accounts to sync ---');
            process.exit(0);
        }

        // Chunk insertions if data is large
        const CHUNK_SIZE = 100;
        for (let i = 0; i < dataToInsert.length; i += CHUNK_SIZE) {
            const chunk = dataToInsert.slice(i, i + CHUNK_SIZE);
            try {
                await User.insertMany(chunk, { ordered: false });
                successCount += chunk.length;
                console.log(`Inserted chunk ${Math.floor(i / CHUNK_SIZE) + 1}...`);
            } catch (err) {
                console.error(`Error inserting chunk ${Math.floor(i / CHUNK_SIZE) + 1}:`, err.message);
                if (err.writeErrors) {
                    console.error("First write error:", err.writeErrors[0].errmsg);
                }
                if (err.result && err.result.nInserted) {
                    successCount += err.result.nInserted;
                    failCount += (chunk.length - err.result.nInserted);
                } else {
                    failCount += chunk.length;
                }
            }
        }

        console.log('--- Sync Completed ---');
        console.log(`Successfully Added: ${successCount}`);
        console.log(`Failed to Add: ${failCount}`);
        
        process.exit(0);
    } catch(err) {
        console.error("Critical Error during Sync:", err);
        process.exit(1);
    }
}

syncAccounts();
