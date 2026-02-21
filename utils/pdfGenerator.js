const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

exports.generateTransactionLedgerPDF = async (userId, transactions, userName = '') => {
  const templatePath = path.join(__dirname, '../templates/creditNoteTemplate.html');
  console.log(' Template path:', templatePath);

  let html = fs.readFileSync(templatePath, 'utf-8');

  const rows = transactions.map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${t.uniqueCode || '-'}</td>
      <td>${t.narration || '-'}</td>
      <td class="text-right">${t.amount || '0'}</td>
      <td class="text-right">${t.balance || '0'}</td>
      <td>${new Date(t.createdAt).toLocaleString()}</td>
    </tr>
  `).join('');

  const totalCredits = transactions.reduce(
    (sum, t) => sum + Math.abs(Number(t.amount?.replace(/[^0-9.-]/g, '') || 0)),
    0
  );

  //  use uniqueCode as Credit Note No
  const creditNoteNo = transactions[0]?.uniqueCode || 'N/A';

  html = html
    .replace('{{transactions}}', rows)
    .replace('{{date}}', new Date().toLocaleDateString())
    .replace('{{creditNoteNo}}', creditNoteNo)
    .replace('{{totalTransactions}}', transactions.length)
    .replace('{{totalCredits}}', totalCredits)
    .replace('{{recipientName}}', userName);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();

  return pdfBuffer;
};
