require('dotenv').config();
require('../database/mongoose');
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

async function analyze() {
    try {
        const session = await loginToFocus8();

        // Optimized Focus8 Query
        const query = `SELECT iMasterId, sName, sCode, sTelNo FROM vmCore_Account WHERE istatus <> 5 AND iAccountType = 5 AND sCode LIKE 'D%' AND LEN(sCode) = 12 AND sTelNo != ''`;
        
        console.log("Fetching filtered Dealers directly from Focus8...");
        const res = await axios.post(`${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`, {
            data: [{ Query: query }]
        }, { headers: { fSessionId: session } });

        const focusDealers = res.data?.data?.[0]?.Table || [];
        console.log(`Focus8 Dealers returned by query: ${focusDealers.length}`);

        // Get existing Dealer users for sync comparison
        const dbUsers = await User.find({ accountType: 'Dealer' });
        const dbDealersWithCode = new Set(dbUsers.filter(u => u.dealerCode).map(u => u.dealerCode.trim().toLowerCase()));

        let inSync = 0;
        let toAdd = 0;
        
        for (const account of focusDealers) {
            const sCode = account.sCode.trim().toLowerCase();
            if (dbDealersWithCode.has(sCode)) {
                inSync++;
            } else {
                toAdd++;
            }
        }

        console.log(`\n--- Sync Status (Using SQL-level Filters) ---`);
        console.log(`Total dealers found in Focus8: ${focusDealers.length}`);
        console.log(`Already present in MongoDB: ${inSync}`);
        console.log(`Missing in MongoDB (Needs sync): ${toAdd}`);
        
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
analyze();
