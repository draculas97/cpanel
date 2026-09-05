// Stacia Corp email signature.
//
// The logo, "Celebrating 6 Years" artwork and social icons are embedded as
// inline CID attachments (signatureImages()) rather than hosted URLs. Mail
// clients like Outlook and Gmail fetch hosted images through their own
// server-side proxy, not the recipient's browser — and staciacorp.com's
// host-level bot-protection (a BitNinja-style "Human Presence Check") blocks
// those proxy fetches because they don't look like a real browser. The
// images rendered fine in a Chrome tab but showed up broken in the actual
// email. CID attachments are carried inside the message itself, so nothing
// needs to be fetched after delivery and nothing can be blocked.

const LOGO_B64 =
  "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";
const YEARS_B64 =
  "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";
const ICONS_B64 =
  "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";

const HOSTED_ASSETS_BASE = "https://staciacorp.com/mail-signature-assets";

export function signatureImages() {
  return [
    {
      cid: "stacia-logo",
      filename: "stacia-logo.png",
      contentType: "image/png",
      content: Buffer.from(LOGO_B64, "base64"),
    },
    {
      cid: "stacia-years",
      filename: "stacia-6-years.jpg",
      contentType: "image/jpeg",
      content: Buffer.from(YEARS_B64, "base64"),
    },
    {
      cid: "stacia-icons",
      filename: "stacia-social-icons.png",
      contentType: "image/png",
      content: Buffer.from(ICONS_B64, "base64"),
    },
  ];
}

function signatureBlock({ logoSrc, yearsSrc, iconsSrc }) {
  return `
  <table cellpadding="0" cellspacing="0" border="0" style="border-top: 2px solid #0A2540; padding-top: 10px; margin-top: 16px; font-family: Arial, Helvetica, sans-serif;">
    <tr>
      <td style="vertical-align: top; padding-right: 20px; width: 340px;">
        <div style="font-size: 16px; font-weight: bold; color: #111111;">Sarabesh Sriram</div>
        <div style="font-size: 12px; color: #555555; margin-bottom: 8px;">Founder Partner, Chief Executive Officer</div>
        <div style="border-top: 1px solid #cccccc; margin: 8px 0;"></div>
        <div style="font-size: 12px; line-height: 1.6; color: #333333;">
          Mobile : +91-87 5459 5641 &nbsp;|&nbsp; Phone : +91-44 2250 4150<br>
          Mobile : +91-93 6303 4150<br>
          Email: <a href="mailto:sarabeshsriram@staciacorp.com" style="color:#1155cc;">sarabeshsriram@staciacorp.com</a><br>
          Email: <a href="mailto:contactus@staciacorp.com" style="color:#1155cc;">contactus@staciacorp.com</a>
        </div>
        <div style="font-size: 12px; line-height: 1.6; color: #333333; margin-top: 8px;">
          Ground Floor, C-53, Guindy Industrial Estate, Chennai, Tamil Nadu 600032<br>
          <a href="https://www.staciacorp.com" style="color:#1155cc;">www.staciacorp.com</a>
        </div>
        <div style="font-size: 14px; font-weight: bold; color: #1155cc; margin-top: 10px;">
          Stacia Corp Celebrates 6 years of Innovation !!!
        </div>
      </td>
      <td style="vertical-align: top; text-align: center; width: 260px;">
        <img src="${logoSrc}" alt="Stacia Corp" style="max-width: 220px; display:block; margin: 0 auto 6px auto;"><br>
        <img src="${yearsSrc}" alt="Celebrating 6 Years" style="max-width: 260px; display:block; margin: 0 auto;"><br>
        <img src="${iconsSrc}" alt="Social" style="max-width: 200px; display:block; margin: 6px auto 0 auto;">
      </td>
    </tr>
  </table>
  <p style="font-size: 11px; font-style: italic; text-align: center; margin-top: 14px; font-family: Arial, Helvetica, sans-serif; color: #333333;">Please do not print this email unless it is necessary. Every unprinted email helps the environment.</p>
  <hr style="border: none; border-top: 1px solid #cccccc;">
  <p style="font-size: 10px; color: #777777; line-height: 1.5; font-family: Arial, Helvetica, sans-serif;">
    The content of this email is confidential and intended for the recipient specified in the message only. It is unauthorized to share any part of this message with any third party, without the written consent of the sender. If you received this message by mistake, please reply to this message and follow with its deletion, so that we can ensure such a mistake does not occur in the future. Thank you for your cooperation and understanding. Stacia Corp puts the security of the client at a high priority. Therefore, we have put efforts into ensuring that the message is error and virus-free. Unfortunately, full security of the email cannot be ensured as, despite our efforts, the data included in emails could be infected, intercepted, or corrupted. Therefore, the recipient should check the email for threats with proper software, as the sender does not accept liability for any damage inflicted by viewing the content of this email. A quotation request is sent to compare available offers and does not imply entering into a legally binding contract. No employee of Stacia Corp has the authority to conclude any binding contract without the explicit written consent of their supervisor.
  </p>`;
}

// For drafts / any raw MIME message that carries its own attachments.
export function signatureHtmlCid() {
  return signatureBlock({
    logoSrc: "cid:stacia-logo",
    yearsSrc: "cid:stacia-years",
    iconsSrc: "cid:stacia-icons",
  });
}

// For the relay JSON payload (PHP mail(), no attachment support) — falls
// back to the hosted copies of the same images.
export function signatureHtmlHosted() {
  return signatureBlock({
    logoSrc: `${HOSTED_ASSETS_BASE}/logo_small.png`,
    yearsSrc: `${HOSTED_ASSETS_BASE}/years_small.jpg`,
    iconsSrc: `${HOSTED_ASSETS_BASE}/icons_small.png`,
  });
}

export function signaturePlainText() {
  return `

--
Sarabesh Sriram
Founder Partner, Chief Executive Officer
Mobile: +91-87 5459 5641 | Phone: +91-44 2250 4150
Mobile: +91-93 6303 4150
Email: sarabeshsriram@staciacorp.com
Email: contactus@staciacorp.com
Ground Floor, C-53, Guindy Industrial Estate, Chennai, Tamil Nadu 600032
www.staciacorp.com

Stacia Corp Celebrates 6 years of Innovation !!!
`;
}
