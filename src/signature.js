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
//
// For send_email (the PHP relay path, which can't carry attachments), the
// same images are served from this Node service's own /mail-signature-assets
// route (see signatureAssetFiles() + server.js) instead of from
// staciacorp.com directly, since that host's bot-protection was blocking
// those hosted fetches too.

const LOGO_B64 =
  "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";
const YEARS_B64 =
  "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";
const ICON_FACEBOOK_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAFAAAABYBAMAAACQbG3zAAAAMFBMVEWWnavQ1NpQXHJsd4q2u8U2RF69wsp6hJUQID4hL0z+/v4VJUPl5+oGFzYpOFMACitNaeScAAAAEHRSTlP/////////////////////zSGylAAAAkZJREFUeNrtls9r02AYx7950yqldlihuoNKiIyhMMzaowxSmYddbLR48KZgGYKH7LKD+xPE0cFu86AnQWFEj+vEQodQNND9uIzRmNDjhJbGEiTNWw89KHN58wrzZHN88uH7fZ7nfd4fwhvwfQQjcASOwH8Cxo4Py0BPq8D6FRGO266khKINkM8Vi21dKrRfbNZyG67GtvYGL3Nt4O2V5oRks0C9k+3mEmXz2o0qU9EbiG7dRHv2q8huj9TJfjIhE1xCnAWSovijKzdsihZ8pmJ/MEUkZXrsYywV0XB96RwV500IzXzkysAzM3XkD2xmw6u+7U+N1R+mG0aEoojWaXX68dzvax1mra9fnIsYs54yVKAR80j0KgCU+54ss0CSKYguKKC4T2/NS+FgpvD6egKA6D7ZaCt3GcV0sm7dJJf3B+9loTYeDhZJf9EEtekXf2fythNu3Vc+3JQAEPP77C4URtXizjBGCK52WO0JlOFwUcA7y6gajQWrBQC5M5sptRJejBDfQtkMdnOPGhCc8XBF476zp2NCm9xO32vOrIcrHr6bqbnPuwhS5nb+gDHhdK0UpEAoVCf5zLIZxdC1BwAkrCaWrYjTzFCBYCEwTvB8rAIYxCPB3vAIoxqfdfnon/AcKRco6id9K9gcYJJb0fgba4kH1AAEZS7FAHFOa4kzxzhXMT3e9iQB3+bro7poOXnCkePK1qtYzI/eCkJwZy+/rx6N/nmxXyh+A06dX458KhwGaQCGFakIIgGwOB4f1Bq9zf5r8CdXgLvFPd0lLgAAAABJRU5ErkJggg==";
const ICON_LINKEDIN_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAFAAAABYBAMAAACQbG3zAAAAMFBMVEWXnqvR1NpqdIc5Rl9TX3QLGzq1usN7hJW8wckgLkv+/v4WJkQIGTkmNVDn6exKVm0G0OSCAAAAEHRSTlP/////////////////////zSGylAAABHVJREFUeNrtlltsFGUUx38zzHa39OIOIYU0aJe1ARPQLtZmTUx0sYQHUNgXg3gpY5sgGGKXqgEfuBSfNuGyRCSxCbogSOIlaTBETEAHY0yaLmkhaKxhp6sQKAR2ZnuTWdYdH3ZburNb4osvpvM03/f95n/O950z53zCF/y7R2QGnAFnwP8ElOzjRh8AVTH1gaDf954OwLrFVXsfAPqb9E6vF9BcejAUmbokTC0AUpveER/tAlpPNw7IA+o0oNSmd8STn6TAvFuzcOn1io+n2XXjWnFPcmcn4bCzemjwcu1f75ZWlFqHU7c0wQ2AZXjX3V4eVkuB/rpHz6TgwCtRyhQZa7hp7vy9JXYtNYg1qUjIVNgIGG6h+k7t8oBa7GOjsfAz08SZG1kgaJc+fap4M1KDVLvbuW1yQYfqPwPNgSKwMfjcrtABXdcnSUMID5/0FYG+Yy63tf39p/dMalq0f71JsoOSteOgyZZkQ5mHrvxchMv9VwM2cCR4POEUv9G0Za1MOKpQe8rhs4GBY79DxCHU7EfAPWEve6fWbrpJfNaNYuajQFqWo1h6ZNQj2cD0ki4OIDpWiRk3zD4JW4Gtt769WghKjN5AIZiOLhENOLzByM1XPkOgIISNwTvREPy9eHU8aensAS2nI9qSwr9ovM8czy5qDsavgdALK7o0ONpe/mQ+MfJf+O4BiEr2o19iD+nJ7YJrsMYjo1DxVqGPDtYAjCRMrfkJTQtv3KB1thAlTffIVB8lMHAax93CPF37SYYvkT8c/yGUYoxggWIa4GTotNJjJl6N90P8SPmiiVgUnKMIIJmPqwqes4AvU/baQAQsoiVLSoQorPDrenOgN7JSiTqnqz2hADCySfSe8KljCiFAKQSzeUUVEr6EN14LWREQbIpl+WEGBQ/RigBUAVBRZHoOhPKq/fddMcGjTgEz9+i2F8SRnKXgkQLFfseU8/dxP3XHDttMrw9GiEQIBaIEAQMpd84tYqwAvND9q2IqivMdH6Gow+mBttzP4jYLFTNU1hGtXu1oF7utVffGRhfvtsRsmuHTqIVFakvSfxBrc4yO/u+p70vUVdPwVYob+9YsKPSxN/ujARVeb/zc894lq2a/6O2YC9bSRMS2GbVlJXAoHr92efhiMqoeiu/jD8S26xlbfZRa2183rDmQ1erRIFsPg+4b+87fVAvrY6bsg1inoKXLEDUAUYsqsrk04VbtIextuWsgz5NnI8uAIG+VcbUNVRXF+kL3+V2YEcbRdcDCDPNzdn2sCMxcnOUynCFrYmw4ndZR9VyJ0nyhfNkOA+N+3rS7KoVYiQzPCHvH63Tk/PO5fqlOfbhk+5A23U7d0mQI4wyhe9+8MrXPzHpp8jXbqfe8IN4sp6kvZI54WweHrj9Wurv2nBk61SdlE0c36+L8jlkJOTJdG+5purIrfuJl3mbBid8G3vhu2n7d09u0n526+EhitJLOI9P3a/D71uYqg6s8fpYHgEhtbNPwhhmw3SnsYP72UXT3KAZnLnH/W/AfLMyozr//ipEAAAAASUVORK5CYII=";
const ICON_X_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAFAAAABYBAMAAACQbG3zAAAAMFBMVEVsc4pRWHOWmqvW2N4iLE46QmF7gZa4u8a9wMr9/f4KFToZI0YACDAvOFgSHUGTl6gWJrQ1AAAAEHRSTlP/////////////////////zSGylAAABAtJREFUeNrtll9oG3UcwD93uSXZMG3iykAImF7HnqY9d4PO0rJr6cP2tvnkW7MJ9UEqwQ5XYW7d2MMqitkQoVVm+uSLiL7tIWuurQrVC1zdcKy011SGG1J3t2WutbskPrS1TXJXfPFF+ns6fvfh+//PTxjh3x2RHXAH3AH/E1D652s14wn01YKrmaM3zTqs5dToOils9PXo0a8Xo3Wg/bgrmKyycVU6/+cttcMwptQpde1MqWrHTMKhWuKq+87sTMKSgXJhTURZtmjvn4n1VdmYKcYXEsgAoryhWOY354+TmWRVeH5sczZNWxdqIX4lfFPttfTKTcPaDFq3q4PUk5XHtTvV4LPCHF3mMBBKAXliMPzpu5Zw8eqd6sxIYA6PjFyNXRteu7gmj6QBMjUBDx+yHqVWOuBI7j6open0YPisotfneqVcUHCx7aXjL9CaZeRMlpCe8Mi1CWDL0uyT4Ye9/CzpAIX2/uSduuoJgGjeTdg30iJXcjak/MqsjYiiiPISCB86SWcICA3VqQZ34gAwT/OrvwT2nx6PLqds9ANeEgMUTRMF4fcHlTzSWTQf1e6Zhk4wWerscIqF8IDibaMEg10zCkUqto0ljB/065nb2stu9BaHC6db5aQQH9AxvcGSlLs+Qcss+eI8TeOfS6ZfeExyKUkCUMbCC3onig9Y0ji3px2gyLiD6d2uuACKkCHIfLExIIrbDIDbLOvRYNzcdgAAlHq4K+yeLypQKm8nkbz7SN87wD16u7VtZk8AJuOpXd8rq+grpzTFL44AZdJrf5eeN6Z8JZbUVhYvcIKkFqzoaVeR/JxxdWH0p2efRX6YDSbHJgx9r7/qbuOpMm8Ck7yP5vqC0uuVuCW84eJGeiebtqZwq2olQPC5x/uE6PU+smbzk32m7S0xkM03515ajRuxUTdC0DmeJuEJuojnnk4ttjXoUUyM3idp0cdGKZ1zD/NBbokMRK457/nEUSpdJtken5Pvd0kKxc4Xp/0CruGUx9oU9lzeo0LRpAGGvFphGjJNy1juA+F6SySigCeYYPdQNHZsQOhhWY9aLVPaCoV61eFD96bTQ4J0XjHzTUhC1GoY45PN+ShuqRvSUs8x8n+lS6HB74RYLBr+yMOZFRPeDF+5XyCUgrcHDcMw9JRHCl1cLWS19tmSBq5+qsFUS+YXkxXW5+MGuCu5/+Gcza8yVhZEmcWYhT2ZWLjwZXcV6H781smEvLaF2FxIiPrBfdU2KpMNHk1aDldO1OzCpUuzjXrP1mLvyWp6/S7kht1sqDYr4Y0L1VaLav+3zTVeB91LjS1Rp1Z10OkK1sQxOfFaxa7UnvjF9b2+qTrIxJGq4SA0Orgxva9msQOj2709tjZX384j7v8N/g3pMJNj9frjZwAAAABJRU5ErkJggg==";
const ICON_INSTAGRAM_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAFAAAABYBAMAAACQbG3zAAAAMFBMVEXX2t9PW3Gaoa5pc4Y4Rl8JGDi1usN6g5S8wckgLkv9/v4HGDgWJkQnNlGPl6XR1drlnZcVAAAAEHRSTlP/////////////////////zSGylAAABIVJREFUeNrtll1sFFUUx/+zu51pJ617p9QtxdUWUAkW7BJ4IErpVgMP1QgJpoLGMGJoi1U6QInFoLVEDaWkbKMSUB+maIxZGxLQSPgILAKGhza0VUngoR+kErfQzF23TDvTtdeHfu1MZ4nPhHk7yS//859zzj33cmH8v8+Fh+BD8EEGPZZIl710JuIgqs6gXpP+2sKZsGKeMk91AnV5X9vei+unwrFzP6+8PU1y4SS9XXJLpCfJ/5Mjozensicpyq6tZX1YnpSiw1XounrGDur6sjJ/2wyViIMTipcqYdWueET012tJeoaO1p/W3ZrlsXzR0CkKk7fUi3u0tTlsLbj+j7mSAkmcJElg8bYi2QrK38ypB9AqTotxUsN8GPdO21t4NApIkiJIk7EqrLi8krDzB6gV5M8VUW4qpSQRKO+5fI83sHg7bwH1u6tDQBcBAC69rk4CRfXYyS4c/cPmkaxnQIAC4ITijo4dpBXf9TQBcto1K3gwAoDBACcUL3h6y+XsYHfEi1ywREy2gH0wASAEoWT+2R/PZq+oRWgToCIwa3B5qGCV6SXVtO6Tjex6wfiVz3ZHFSDiMLgIcX8VHuuNEfaOz19wc03PKqCZdwLl7LW/ixwFiaEv3y2tOqQ5nhkZrZ7CRuL1LcijGP81Y7+XAgg6Ke7Y+YOoxpcY5QF4S0bYZup1UDTBMHKtkcT73YOfP1GDvjcJAMMhtQlkFbR4n1rmbzqXtgvDO0sxM04WjyqnBKlx5ur2vOaGgJTRxDkvAAFAdy0GN2hQzXvcb7Evcsl9NoV3b5SiAu7zBzFcLKrUGRzxBDNOA6ZYweIRkq0IRirFMXyUYBAEgqN3MXr/JRUJfAUAm4cBQEkNfhycPDKZE8OUAkyD6emUDYNCANKDEFKAGYkIq5zr43VwH75KB9dH5VSKzwZjVUMSoKZfP+71X+JBHEADciKUCdFVKpnIekPjcqLU+a95uN2ZBNU5Db63Xjge0y8WTQyAU2rjRhGqfhnY82mhjMzmkHMdeXBgz5yieV+f0PS/FW/Bt9EZi/bBpaGNt/pxWPNEiX7nXT6FR6hgiT9d+WRPz40Y6jYcOpALCJOn0OaRaOdJHgMjbN/uaFRIQuwtNBK95YsqG4y3t75y4TAAQBm1ggUwgU6OZ5e+zNy//faVMj81FQBZrqAVrIUAeSnEkHGxd+GaFwf96/A+AHg6vbbUQQBuCNsOjbYvl+a0118IATAoPFAt5Rm+U72NByCwkLIpCI3JEjoX6xgRllnqKGY/tnhyBwBFGsBJ4IKabvpy1DJLasHT9b2tAiwCCAo1rR5bKnM/gBYFgEZN0ygABCik7nFi+5mqoToCXtM0rQIA0zRN02B6CtfZei3mzRmQJnprqgA/MdtzlYGTz9uuOH1L/3P1+dYLjqSVPjJovzTF8ZdyToQS8SRQGikhPeFZY6aWx8pWwB0A8K8bQAfgqj4mzp5HMS++xPdyZHoZL0CJsrbzzOynAvQa4/WIxeTqkNObAkA54yybLRZOca7DFg5JnE3x4fvxQQb/A5bAnmMHD4CwAAAAAElFTkSuQmCC";

const HOSTED_ASSETS_BASE =
  process.env.SIGNATURE_ASSETS_BASE_URL ||
  `${(process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || "https://cpanel-xwy1.onrender.com").replace(/\/+$/, "")}/mail-signature-assets`;
const ASSET_CACHE_BUST = "2026-09-08b"; // bump when hosted image bytes change, so mail-provider proxy caches (which ignore our Cache-Control) fetch fresh bytes instead of serving a stale cached copy forever

// Where each icon links to.
const SOCIAL_LINKS = {
  facebook: "https://www.facebook.com/staciacorp/",
  linkedin: "https://www.linkedin.com/company/43249926/",
  x: "https://x.com/StaciaCorp",
  instagram: "https://www.instagram.com/stacia_corp_/",
};
const WEBSITE_URL = "https://www.staciacorp.com";

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
      cid: "stacia-icon-facebook",
      filename: "stacia-icon-facebook.png",
      contentType: "image/png",
      content: Buffer.from(ICON_FACEBOOK_B64, "base64"),
    },
    {
      cid: "stacia-icon-linkedin",
      filename: "stacia-icon-linkedin.png",
      contentType: "image/png",
      content: Buffer.from(ICON_LINKEDIN_B64, "base64"),
    },
    {
      cid: "stacia-icon-x",
      filename: "stacia-icon-x.png",
      contentType: "image/png",
      content: Buffer.from(ICON_X_B64, "base64"),
    },
    {
      cid: "stacia-icon-instagram",
      filename: "stacia-icon-instagram.png",
      contentType: "image/png",
      content: Buffer.from(ICON_INSTAGRAM_B64, "base64"),
    },
  ];
}

// Filenames served by the /mail-signature-assets/:filename route (see
// server.js) — used by signatureHtmlHosted() below for the send_email path.
export function signatureAssetFiles() {
  return {
    "logo_small.png": { contentType: "image/png", buffer: Buffer.from(LOGO_B64, "base64") },
    "years_small.jpg": { contentType: "image/jpeg", buffer: Buffer.from(YEARS_B64, "base64") },
    "icon_facebook.png": { contentType: "image/png", buffer: Buffer.from(ICON_FACEBOOK_B64, "base64") },
    "icon_linkedin.png": { contentType: "image/png", buffer: Buffer.from(ICON_LINKEDIN_B64, "base64") },
    "icon_x.png": { contentType: "image/png", buffer: Buffer.from(ICON_X_B64, "base64") },
    "icon_instagram.png": { contentType: "image/png", buffer: Buffer.from(ICON_INSTAGRAM_B64, "base64") },
  };
}

function socialIconsTable({ facebookSrc, linkedinSrc, xSrc, instagramSrc }) {
  const cell = (href, src, alt) =>
    `<td style="padding: 0 4px;"><a href="${href}" style="text-decoration:none;"><img src="${src}" width="20" height="22" alt="${alt}" style="display:block; border:0;"></a></td>`;
  return `
        <table cellpadding="0" cellspacing="0" border="0" style="margin: 6px auto 0 auto;">
          <tr>
            ${cell(SOCIAL_LINKS.facebook, facebookSrc, "Facebook")}
            ${cell(SOCIAL_LINKS.linkedin, linkedinSrc, "LinkedIn")}
            ${cell(SOCIAL_LINKS.x, xSrc, "X")}
            ${cell(SOCIAL_LINKS.instagram, instagramSrc, "Instagram")}
          </tr>
        </table>`;
}

function signatureBlock({ logoSrc, yearsSrc, facebookSrc, linkedinSrc, xSrc, instagramSrc }) {
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
          <a href="${WEBSITE_URL}" style="color:#1155cc;">www.staciacorp.com</a>
        </div>
        <div style="font-size: 14px; font-weight: bold; color: #1155cc; margin-top: 10px;">
          Stacia Corp Celebrates 6 years of Innovation !!!
        </div>
      </td>
      <td style="vertical-align: top; text-align: center; width: 260px;">
        <a href="${WEBSITE_URL}"><img src="${logoSrc}" alt="Stacia Corp" style="max-width: 260px; display:block; margin: 0 auto 6px auto; border:0;"></a>
        <a href="${WEBSITE_URL}"><img src="${yearsSrc}" alt="Celebrating 6 Years" style="max-width: 260px; display:block; margin: 0 auto; border:0;"></a>
        ${socialIconsTable({ facebookSrc, linkedinSrc, xSrc, instagramSrc })}
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
    facebookSrc: "cid:stacia-icon-facebook",
    linkedinSrc: "cid:stacia-icon-linkedin",
    xSrc: "cid:stacia-icon-x",
    instagramSrc: "cid:stacia-icon-instagram",
  });
}

// For the relay JSON payload (PHP mail(), no attachment support) — served
// from this service's own /mail-signature-assets route (see
// signatureAssetFiles() above) rather than staciacorp.com directly, since
// that host's bot-protection was blocking hosted-image fetches too.
export function signatureHtmlHosted() {
  // Cache-bust: some mail providers proxy/cache these hosted images by exact
  // URL and ignore our Cache-Control header, so a URL that ever served a
  // broken image can stay stale in their cache indefinitely. Appending
  // ASSET_CACHE_BUST forces a fresh URL (and fresh fetch) whenever the
  // underlying bytes change.
  return signatureBlock({
    logoSrc: `${HOSTED_ASSETS_BASE}/logo_small.png?v=${ASSET_CACHE_BUST}`,
    yearsSrc: `${HOSTED_ASSETS_BASE}/years_small.jpg?v=${ASSET_CACHE_BUST}`,
    facebookSrc: `${HOSTED_ASSETS_BASE}/icon_facebook.png?v=${ASSET_CACHE_BUST}`,
    linkedinSrc: `${HOSTED_ASSETS_BASE}/icon_linkedin.png?v=${ASSET_CACHE_BUST}`,
    xSrc: `${HOSTED_ASSETS_BASE}/icon_x.png?v=${ASSET_CACHE_BUST}`,
    instagramSrc: `${HOSTED_ASSETS_BASE}/icon_instagram.png?v=${ASSET_CACHE_BUST}`,
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
