require('dotenv').config();
require('../database/mongoose');
const User = require('../models/User');

async function checkDB() {
    try {
        const dbUsers = await User.find({ accountType: 'Dealer' });
        console.log(`Total Dealers in MongoDB: ${dbUsers.length}`);

        let startWithD = 0;
        let notStartWithD = 0;
        let length12 = 0;
        let notLength12 = 0;

        for (const user of dbUsers) {
            const code = user.dealerCode ? user.dealerCode.trim() : "";
            if (code.startsWith('D') || code.startsWith('d')) {
                startWithD++;
            } else {
                notStartWithD++;
            }

            if (code.length === 12) {
                length12++;
            } else {
                notLength12++;
            }
        }

        console.log(`Dealers starting with 'D': ${startWithD}`);
        console.log(`Dealers NOT starting with 'D': ${notStartWithD}`);
        console.log(`Dealers with length 12: ${length12}`);
        console.log(`Dealers NOT with length 12: ${notLength12}`);

        process.exit(0);
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}
checkDB();
