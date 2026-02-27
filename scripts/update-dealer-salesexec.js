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

async function updateSalesmanPhones() {
    try {
        console.log("Connected to DB");
        const session = await loginToFocus8();
        console.log("Logged into Focus8");

        // 1. Fetch Salesman Data
        console.log("Fetching Salesman data...");
        const salesmanRes = await axios.get(`${FOCUS8_BASE_URL}/List/Masters/Core__salesman`, {
            headers: { fSessionId: session }
        });
        const salesmanData = salesmanRes.data?.data || [];
        
        const salesmanMap = new Map();
        for (const sm of salesmanData) {
            if (sm.sName && sm.SalesManPhNO) {
                const firstPhone = sm.SalesManPhNO.split(',')[0].trim();
                salesmanMap.set(sm.sName.trim().toLowerCase(), { 
                    phone: firstPhone,
                    name: sm.sName.trim()
                });
            }
        }
        console.log(`Mapped ${salesmanMap.size} distinct salesman names to info objects.`);

        // 1.5 Ensure Sales Executives exist in MongoDB
        console.log("Checking and creating missing Sales Executives...");
        const allMobilesInDB = new Set((await User.find({}, { mobile: 1 })).filter(u => u.mobile).map(u => u.mobile.trim()));
        let newSalesExecs = [];
        let newlyAddedMobiles = new Set();
        
        for (const [sNameLower, info] of salesmanMap.entries()) {
            if (!allMobilesInDB.has(info.phone) && !newlyAddedMobiles.has(info.phone)) {
                newSalesExecs.push({
                    name: info.name,
                    mobile: info.phone,
                    accountType: 'SalesExecutive',
                    status: 'active'
                });
                newlyAddedMobiles.add(info.phone);
            }
        }

        if (newSalesExecs.length > 0) {
            console.log(`Found ${newSalesExecs.length} Sales Executives missing in DB. Creating them...`);
            try {
                await User.insertMany(newSalesExecs, { ordered: false });
                console.log(`Successfully created ${newSalesExecs.length} new Sales Executive accounts.`);
            } catch (err) {
                console.error("Error creating some Sales Executives. They might be duplicates:", err.message);
            }
        } else {
            console.log("All necessary Sales Executives already exist in the database.");
        }

        // 2. Fetch Account Data to link Salesman -> Dealer
        console.log("Fetching Account data...");
        const query = `SELECT sCode, SalesmanName from vmCore_Account where istatus <>5 and iAccountType = 5 AND sCode LIKE 'D%' AND LEN(sCode) = 12 AND sTelNo != '';`;
        const accRes = await axios.post(`${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`, {
            data: [{ Query: query }]
        }, { headers: { fSessionId: session } });

        const accounts = accRes.data?.data?.[0]?.Table || [];
        
        const dealerCodeToPhone = new Map();
        let unmappedSalesmanNames = new Set();
        
        for (const account of accounts) {
            const sCode = account.sCode ? account.sCode.trim().toLowerCase() : null;
            const salesmanName = account.SalesmanName ? account.SalesmanName.trim().toLowerCase() : null;

            if (sCode && salesmanName) {
                const info = salesmanMap.get(salesmanName);
                if (info) {
                    dealerCodeToPhone.set(sCode, info);
                } else {
                    unmappedSalesmanNames.add(salesmanName);
                }
            }
        }
        
        console.log(`Mapped ${dealerCodeToPhone.size} dealer codes to salesman phone numbers.`);
        if (unmappedSalesmanNames.size > 0) {
            console.log(`Found ${unmappedSalesmanNames.size} distinct salesman names in Accounts that don't have mobile mapping in Salesman Master.`);
        }

        // 3. Update MongoDB Dealer Users
        console.log("Fetching MongoDB Dealer users...");
        const dbUsers = await User.find({ accountType: 'Dealer' });
        console.log(`Found ${dbUsers.length} Dealer users in DB.`);

        let updateCount = 0;
        let notFoundInMappingCount = 0;
        let alreadyUpToDateCount = 0;
        
        let salesExecUpdatedCount = 0;
        let primaryContactPersonUpdatedCount = 0;
        let primaryContactPersonMobileUpdatedCount = 0;

        const bulkOps = [];

        for (const user of dbUsers) {
            const code = user.dealerCode ? user.dealerCode.trim().toLowerCase() : null;
            if (!code) continue;

            const salesmanInfo = dealerCodeToPhone.get(code); // returns { phone, name }
            if (salesmanInfo) {
                let updates = {};

                if (user.salesExecutive !== salesmanInfo.phone) {
                    updates.salesExecutive = salesmanInfo.phone;
                    salesExecUpdatedCount++;
                }

                // Conditionally update primaryContactPerson
                if (!user.primaryContactPerson || user.primaryContactPerson.trim() === '') {
                    updates.primaryContactPerson = salesmanInfo.name;
                    primaryContactPersonUpdatedCount++;
                }

                // Conditionally update primaryContactPersonMobile
                if (!user.primaryContactPersonMobile || user.primaryContactPersonMobile.trim() === '') {
                    updates.primaryContactPersonMobile = salesmanInfo.phone;
                    primaryContactPersonMobileUpdatedCount++;
                }

                if (Object.keys(updates).length > 0) {
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: user._id },
                            update: { $set: updates }
                        }
                    });
                    updateCount++;
                } else {
                    alreadyUpToDateCount++;
                }
            } else {
                notFoundInMappingCount++;
            }
        }

        console.log(`Prepared ${bulkOps.length} user update operations.`);
        
        if (bulkOps.length > 0) {
            console.log("Executing bulk updates...");
            // Execute in batches just in case
            const BATCH_SIZE = 500;
            let successUpdates = 0;
            for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
                const batch = bulkOps.slice(i, i + BATCH_SIZE);
                const result = await User.bulkWrite(batch);
                successUpdates += result.modifiedCount;
            }
            console.log(`Successfully updated ${successUpdates} users.`);
        } else {
            console.log('No database updates required for Dealer properties.');
        }

        console.log(`\n--- Summary ---`);
        console.log(`New Sales Executive accounts created: ${newSalesExecs.length}`);
        console.log(`Total Dealer users processed: ${dbUsers.length}`);
        console.log(`Dealers skipping update due to missing Salesman Mapping: ${notFoundInMappingCount}`);
        console.log(`Dealers completely up to date already: ${alreadyUpToDateCount}`);
        console.log(`\n--- Fields Updated ---`);
        console.log(`Total Dealers updated: ${bulkOps.length}`);
        console.log(`  - 'salesExecutive' modified: ${salesExecUpdatedCount}`);
        console.log(`  - 'primaryContactPerson' filled: ${primaryContactPersonUpdatedCount}`);
        console.log(`  - 'primaryContactPersonMobile' filled: ${primaryContactPersonMobileUpdatedCount}\n`);

        process.exit(0);

    } catch(err) {
        console.error("Critical Error during update:", err);
        process.exit(1);
    }
}

updateSalesmanPhones();
