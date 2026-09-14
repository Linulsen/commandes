// La version « standalone » de pdfkit n'a pas de types publiés, mais expose la
// même classe que le paquet principal, dont les types sont installés.
declare module "pdfkit/js/pdfkit.standalone.js" {
  import PDFDocument from "pdfkit";
  export default PDFDocument;
}
