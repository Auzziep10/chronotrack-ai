import React, { useState } from 'react';
import { User } from '../types';
import { FileText, Printer, Download, CreditCard, FileSignature, UploadCloud } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { firebaseUploadDocument } from '../services/firebaseService';

interface Props {
  currentUser: User | null;
}

export const PrintableForms: React.FC<Props> = ({ currentUser }) => {
  const [activeForm, setActiveForm] = useState<'direct_deposit' | 'w9'>('direct_deposit');
  const [isUploading, setIsUploading] = useState(false);

  const handlePrint = () => {
    window.print();
  };

import { PDFDocument } from 'pdf-lib';

  const handleUploadToAdmin = async () => {
    if (!currentUser) {
      alert("You must be logged in to submit documents.");
      return;
    }

    setIsUploading(true);
    try {
      let pdfDataUri = '';

      if (activeForm === 'w9') {
        // Fetch the official W-9 form we downloaded to public/fw9.pdf
        const formPdfBytes = await fetch('/fw9.pdf').then(res => res.arrayBuffer());
        const pdfDoc = await PDFDocument.load(formPdfBytes);
        const form = pdfDoc.getForm();
        
        // Read values from DOM
        const name = (document.getElementById('w9-name') as HTMLInputElement)?.value || '';
        const business = (document.getElementById('w9-business') as HTMLInputElement)?.value || '';
        const address = (document.getElementById('w9-address') as HTMLInputElement)?.value || '';
        const city = (document.getElementById('w9-city') as HTMLInputElement)?.value || '';
        const ssn = (document.getElementById('w9-ssn') as HTMLInputElement)?.value || '';
        const ein = (document.getElementById('w9-ein') as HTMLInputElement)?.value || '';
        const taxClassRadios = document.getElementsByName('tax_class') as NodeListOf<HTMLInputElement>;
        let taxClass = '';
        taxClassRadios.forEach(r => { if (r.checked) taxClass = r.value; });

        // Fill form fields based on the IRS fw9.pdf AcroForm names
        try { form.getTextField('topmostSubform[0].Page1[0].f1_01[0]').setText(name); } catch(e){}
        try { form.getTextField('topmostSubform[0].Page1[0].f1_02[0]').setText(business); } catch(e){}
        try { form.getTextField('topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_07[0]').setText(address); } catch(e){}
        try { form.getTextField('topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_08[0]').setText(city); } catch(e){}
        
        // SSN
        if (ssn) {
          const ssnClean = ssn.replace(/\D/g, '');
          try { form.getTextField('topmostSubform[0].Page1[0].f1_09[0]').setText(ssnClean.substring(0,3)); } catch(e){}
          try { form.getTextField('topmostSubform[0].Page1[0].f1_10[0]').setText(ssnClean.substring(3,5)); } catch(e){}
          try { form.getTextField('topmostSubform[0].Page1[0].f1_11[0]').setText(ssnClean.substring(5,9)); } catch(e){}
        }

        // EIN
        if (ein) {
          const einClean = ein.replace(/\D/g, '');
          try { form.getTextField('topmostSubform[0].Page1[0].f1_12[0]').setText(einClean.substring(0,2)); } catch(e){}
          try { form.getTextField('topmostSubform[0].Page1[0].f1_13[0]').setText(einClean.substring(2,9)); } catch(e){}
        }

        // Tax Class Checkboxes (c1_1[0] to [6] etc)
        try {
          if (taxClass === '1') form.getCheckBox('topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[0]').check();
          if (taxClass === '2') form.getCheckBox('topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[1]').check();
          if (taxClass === '3') form.getCheckBox('topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[2]').check();
          if (taxClass === '4') form.getCheckBox('topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[3]').check();
          if (taxClass === '5') form.getCheckBox('topmostSubform[0].Page1[0].Boxes3a-b_ReadOrder[0].c1_1[4]').check();
        } catch(e){}

        form.flatten();
        const savedPdf = await pdfDoc.saveAsBase64({ dataUri: true });
        pdfDataUri = savedPdf;

      } else {
        // Fallback to html2canvas for Direct Deposit
        const element = document.getElementById('printable-form-container');
        if (!element) throw new Error("Form container not found");
        
        element.classList.add('print:shadow-none', 'print:border-none');
        const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false });
        element.classList.remove('print:shadow-none', 'print:border-none');

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdfDataUri = pdf.output('datauristring');
      }
      
      await firebaseUploadDocument(currentUser.id, activeForm, pdfDataUri);
      
      alert("Document securely submitted to admin!");
    } catch (err: any) {
      console.error(err);
      alert("Failed to submit document. Error: " + (err.message || "Unknown"));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 animate-fade-in print:p-0 print:m-0 print:max-w-none">
      
      {/* Non-printable Controls */}
      <div className="mb-8 print:hidden">
        <h2 className="text-2xl font-bold text-zinc-900 mb-2">Onboarding Forms</h2>
        <p className="text-zinc-500 mb-6">
          Fill out the required forms below. Once complete, click "Save as PDF" to download the finalized form directly to your device, or "Submit Securely" to send it directly to an Admin's secure vault.
          <strong className="block mt-2 text-amber-600">Note: Data typed here is never saved to the general database. It is only accessible as a locked PDF.</strong>
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-zinc-200">
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveForm('direct_deposit')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
                activeForm === 'direct_deposit' 
                  ? 'bg-zinc-900 text-white' 
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <CreditCard className="w-4 h-4" /> Direct Deposit
            </button>
            <button
              onClick={() => setActiveForm('w9')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-colors ${
                activeForm === 'w9' 
                  ? 'bg-zinc-900 text-white' 
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <FileSignature className="w-4 h-4" /> W-9 Form
            </button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={handlePrint}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold rounded-lg transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4" /> Save Local PDF
            </button>
            <button
              onClick={handleUploadToAdmin}
              disabled={isUploading}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg transition-colors shadow-sm"
            >
              <UploadCloud className={`w-4 h-4 ${isUploading ? 'animate-bounce' : ''}`} /> 
              {isUploading ? 'Generating PDF...' : 'Submit Securely to Admin'}
            </button>
          </div>
        </div>
      </div>

      {/* Printable Area - Only this will be visible on print because we will hide App.tsx header */}
      <div id="printable-form-container" className="print-area bg-white p-8 sm:p-12 rounded-2xl shadow-lg border border-zinc-200 print:shadow-none print:border-none print:p-0">
        
        {activeForm === 'direct_deposit' && (
          <div className="space-y-8">
            <div className="flex justify-between items-start border-b-2 border-zinc-800 pb-4">
              <div>
                <h1 className="text-3xl font-black text-zinc-900 tracking-tight uppercase">Direct Deposit</h1>
                <p className="text-sm text-zinc-500 font-bold uppercase tracking-widest mt-1">Enrollment Form</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black tracking-widest">CATALYST</div>
              </div>
            </div>

            <div className="bg-zinc-100 p-4 rounded-lg print:bg-transparent print:p-0">
              <h2 className="font-bold text-sm uppercase tracking-wider mb-2">Terms of Agreement</h2>
              <p className="text-xs text-zinc-700 leading-relaxed text-justify">
                I HEREBY AUTHORIZE CATALYST, EITHER DIRECTLY OR THROUGH ITS PAYROLL SERVICE PROVIDER, TO DEPOSIT ANY AMOUNTS OWED ME, BY INITIATING CREDIT ENTRIES TO MY ACCOUNT AT THE FINANCIAL INSTITUTION (HEREINAFTER "BANK") INDICATED ON THIS FORM. FURTHER, I AUTHORIZE BANK TO ACCEPT AND TO CREDIT ANY CREDIT ENTRIES INDICATED BY EMPLOYER, EITHER DIRECTLY OR THROUGH ITS PAYROLL SERVICE PROVIDER, TO MY ACCOUNT. IN THE EVENT THAT EMPLOYER DEPOSITS FUNDS ERRONEOUSLY INTO MY ACCOUNT, I AUTHORIZE EMPLOYER, EITHER DIRECTLY OR THROUGH ITS PAYROLL SERVICE PROVIDER, TO DEBIT MY ACCOUNT FOR AN AMOUNT NOT TO EXCEED THE ORIGINAL AMOUNT OF THE ERRONEOUS CREDIT.
                <br /><br />
                THIS AUTHORIZATION IS TO REMAIN IN FULL FORCE AND EFFECT UNTIL EMPLOYER AND BANK HAVE RECEIVED WRITTEN NOTICE FROM ME OF ITS TERMINATION IN SUCH TIME AND IN SUCH MANNER AS TO AFFORD EMPLOYER AND BANK REASONABLE OPPORTUNITY TO ACT ON IT.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-6 pt-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Signature</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900 font-signature text-xl" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Date</label>
                <input type="date" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" defaultValue={new Date().toISOString().split('T')[0]} />
              </div>

              <div className="col-span-2 border-t border-zinc-100 my-2"></div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Full Name</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" defaultValue={currentUser?.name || ''} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">SS# / Social Security Number</label>
                <input type="password" placeholder="XXX-XX-XXXX" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900 print:text-security-disc" />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Business Name (Optional)</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">EIN# (If Business)</label>
                <input type="text" placeholder="XX-XXXXXXX" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>

              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Street Address</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">State</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Zip Code</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Email</label>
                <input type="email" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Phone</label>
                <input type="tel" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>

              <div className="col-span-2 border-t border-zinc-100 my-2"></div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Bank Name</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">City / State</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Routing Number</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Account Number</label>
                <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>
            </div>
          </div>
        )}

        {activeForm === 'w9' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-2 border-zinc-800 pb-2">
              <div className="text-xl font-black text-zinc-900">Form W-9</div>
              <div className="text-right text-[10px] text-zinc-500 font-medium max-w-xs">
                Request for Taxpayer Identification Number and Certification
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-4 pt-2">
              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">1 Name (as shown on your income tax return)</label>
                <input id="w9-name" type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" defaultValue={currentUser?.name || ''} />
              </div>
              
              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">2 Business name/disregarded entity name, if different from above</label>
                <input id="w9-business" type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
              </div>

              <div className="col-span-2 sm:col-span-1 border border-zinc-200 p-3 rounded">
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">3 Check appropriate box for federal tax classification</label>
                <div className="space-y-2 text-sm text-zinc-700">
                  <label className="flex items-center gap-2"><input type="radio" name="tax_class" value="1" /> Individual/sole proprietor</label>
                  <label className="flex items-center gap-2"><input type="radio" name="tax_class" value="2" /> C Corporation</label>
                  <label className="flex items-center gap-2"><input type="radio" name="tax_class" value="3" /> S Corporation</label>
                  <label className="flex items-center gap-2"><input type="radio" name="tax_class" value="4" /> Partnership</label>
                  <label className="flex items-center gap-2"><input type="radio" name="tax_class" value="5" /> Trust/estate</label>
                </div>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <div className="mb-4">
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">5 Address (number, street, and apt. or suite no.)</label>
                  <input id="w9-address" type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">6 City, state, and ZIP code</label>
                  <input id="w9-city" type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
                </div>
              </div>

              <div className="col-span-2 border-t border-zinc-800 my-2 pt-2">
                <h3 className="font-bold text-sm uppercase tracking-wider mb-2">Part I: Taxpayer Identification Number (TIN)</h3>
                <p className="text-[10px] text-zinc-500 mb-4">Enter your TIN in the appropriate box. The TIN provided must match the name given on line 1 to avoid backup withholding. For individuals, this is generally your social security number (SSN).</p>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Social security number</label>
                    <input id="w9-ssn" type="text" placeholder="XXX-XX-XXXX" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Employer identification number</label>
                    <input id="w9-ein" type="text" placeholder="XX-XXXXXXX" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" />
                  </div>
                </div>
              </div>

              <div className="col-span-2 border-t border-zinc-800 my-2 pt-2">
                <h3 className="font-bold text-sm uppercase tracking-wider mb-2">Part II: Certification</h3>
                <p className="text-[10px] text-zinc-700 leading-relaxed text-justify mb-4">
                  Under penalties of perjury, I certify that:
                  1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and
                  2. I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and
                  3. I am a U.S. citizen or other U.S. person.
                </p>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Signature of U.S. Person</label>
                    <input type="text" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900 font-signature text-xl" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Date</label>
                    <input type="date" className="w-full border-b border-zinc-300 bg-blue-50/30 px-2 py-1.5 focus:outline-none focus:border-zinc-900" defaultValue={new Date().toISOString().split('T')[0]} />
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}
      </div>

    </div>
  );
};
