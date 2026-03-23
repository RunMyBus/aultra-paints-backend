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

async function debugData() {
    try {
        const session = await loginToFocus8();
        console.log("Logged into Focus8");

        const res = await axios.get(`${FOCUS8_BASE_URL}/List/Masters/Core__salesman`, {
            headers: { fSessionId: session }
        });

        const salesmanData = res.data?.data || [];
        console.log(`Total Salesman fetched: ${salesmanData.length}`);
        if(salesmanData.length > 0) {
            console.log("Sample Salesman:", JSON.stringify(salesmanData[0], null, 2));
        }

        const query = `SELECT iMasterId, sName, sCode, SalesmanName FROM vmCore_Account WHERE istatus <> 5 AND iAccountType = 5`;
        const accRes = await axios.post(`${FOCUS8_BASE_URL}/utility/ExecuteSqlQuery`, {
            data: [{ Query: query }]
        }, { headers: { fSessionId: session } });

        const accounts = accRes.data?.data?.[0]?.Table || [];
        console.log(`Accounts fetched: ${accounts.length}`);
        if(accounts.length > 0) {
            console.log("Sample account:", JSON.stringify(accounts[0], null, 2));
        }

        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
debugData();
