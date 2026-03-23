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

        const query = `SELECT * FROM vmCore_Account WHERE istatus <> 5 AND iAccountType = 5`;
        const res = await axios.post(`${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`, {
            data: [{ Query: query }]
        }, { headers: { fSessionId: session } });

        const focusAccounts = res.data?.data?.[0]?.Table || [];

        const dbUsers = await User.find({ accountType: 'Dealer' });
        const dbDealersWithCode = new Set(dbUsers.filter(u => u.dealerCode).map(u => u.dealerCode.trim().toLowerCase()));
        
        const existingMobiles = new Set(dbUsers.filter(u => u.mobile).map(u => u.mobile.trim()));

        let toAddAccounts = [];
        
        for (const account of focusAccounts) {
            const sCode = account.sCode ? account.sCode.trim().toLowerCase() : null;
            if (!sCode) continue;
            if (!dbDealersWithCode.has(sCode)) {
                toAddAccounts.push(account);
            }
        }

        let withMobile = 0;
        let withoutMobile = 0;
        let mobileExistsInDB = 0;
        let duplicatesInFocusBatch = 0;
        let seenMobilesInBatch = new Set();
        let validToAdd = 0;

        for (const acc of toAddAccounts) {
            const mobile = acc.sTelNo ? acc.sTelNo.trim() : null;
            if (mobile && mobile !== '') {
                withMobile++;
                if (existingMobiles.has(mobile)) {
                    mobileExistsInDB++;
                } else if (seenMobilesInBatch.has(mobile)) {
                    duplicatesInFocusBatch++;
                } else {
                    seenMobilesInBatch.add(mobile);
                    validToAdd++;
                }
            } else {
                withoutMobile++;
            }
        }

        console.log(`Focus8 accounts missing in MongoDB (to be added): ${toAddAccounts.length}`);
        console.log(`  - With mobile: ${withMobile}`);
        console.log(`  - Without mobile: ${withoutMobile}`);
        if(withMobile > 0) {
            console.log(`  - Mobile already exists in DB (would cause unique constraint error): ${mobileExistsInDB}`);
            console.log(`  - Mobile duplicated within Focus8 new accounts: ${duplicatesInFocusBatch}`);
            console.log(`  - Valid accounts with unique mobile ready to insert cleanly: ${validToAdd}`);
        }
        
        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
analyze();
