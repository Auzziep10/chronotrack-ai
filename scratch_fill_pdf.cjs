const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

async function run() {
  const pdfBytes = fs.readFileSync('public/fw9.pdf');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  
  form.getTextField('topmostSubform[0].Page1[0].f1_01[0]').setText('Jane Doe');
  form.getTextField('topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_07[0]').setText('123 Main St');
  
  form.flatten(); // Flatting usually works around XFA issues
  const newPdfBytes = await pdfDoc.save();
  fs.writeFileSync('public/test_filled.pdf', newPdfBytes);
}
run();
