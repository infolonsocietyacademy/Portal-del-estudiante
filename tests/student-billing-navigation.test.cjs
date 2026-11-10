const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const admin=fs.readFileSync("admin-workspace.js","utf8");
const billing=fs.readFileSync("admin-billing.js","utf8");
const html=fs.readFileSync("index.html","utf8");

test("The desktop and mobile student rows reuse a single, explicit billing action",()=>{
 assert.match(admin,/data-billing-student=/);
 assert.match(admin,/data-billing-reservation="true"/);
 assert.match(admin,/adminInvoiceStudent/);
 assert.match(admin,/adminStudentMoreActions/);
 assert.match(admin,/adminStudentMobileActions[^\n]+actionButtons\(u\)/);
});
test("Facturar opens the billing administration view before creating the invoice",()=>{
 assert.match(billing,/function openForStudent\(studentId,classReservation=false\)/);
 const route=billing.indexOf('window.olonAdminSections.open("adminBillingBlock")');
 const invoice=billing.indexOf('await newInvoice(studentId,classReservation,true)',route);
 assert.ok(route>=0&&invoice>route);
 assert.match(billing,/void openForStudent\(studentId,button.dataset.billingReservation==="true"\)/);
});
test("The billing editor retains student selection and provides a return path",()=>{
 assert.match(html,/id="billingStudentContext"/);
 assert.match(html,/id="billingReturnStudents"/);
 assert.match(billing,/instance.reset\(null,student\)/);
 assert.match(billing,/window.olonAdminSections.open\("adminStudentsBlock"\)/);
});
