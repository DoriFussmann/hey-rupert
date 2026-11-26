import { CLIENT_TOKENS } from "@/lib/service-order";

// Default NDA: one-way, Rupert is the receiving party. Client tokens are
// filled in by the client when signing, as with the Service Order.
export const DEFAULT_NDA = `# Hey Rupert — Non-Disclosure Agreement

This Non-Disclosure Agreement (this "Agreement") is between The Night Ventures, LLC, a California limited liability company doing business as Hey Rupert ("Rupert"), and ${CLIENT_TOKENS.company_name} ("Client"). It is effective on the date of the last signature (the "Effective Date").

**1. Purpose.** Client will share information with Rupert so that Rupert can provide services under the Service Order between the parties (the "Purpose").

**2. Confidential Information.** "Confidential Information" means non-public information Client discloses to Rupert, in any form, including business plans, financials, metrics, fundraising terms, investor relationships, pitch materials, product and technical information, and customer information.

**3. Exclusions.** Confidential Information does not include information that (a) is or becomes public through no fault of Rupert; (b) Rupert already knew without a duty of confidentiality; (c) Rupert receives from a third party without a duty of confidentiality; or (d) Rupert develops independently without using Client's information.

**4. Rupert's obligations.** Rupert will (a) use Confidential Information only for the Purpose; (b) not disclose it to anyone except its personnel, contractors and service providers who need it for the Purpose and are bound by confidentiality obligations at least as protective as these; and (c) protect it with at least reasonable care. Rupert may use service providers, including AI tools, to process Confidential Information for the Purpose, subject to confidentiality obligations.

**5. Sharing with investors.** Sharing Client-approved materials with prospective investors, as part of a campaign or outreach Client has approved, is part of the Purpose and is not a breach of this Agreement. Rupert will share with prospective investors only materials Client has approved.

**6. Required disclosure.** If the law requires Rupert to disclose Confidential Information, Rupert will give Client prompt notice where legally allowed and disclose only what is required.

**7. Return or deletion.** On Client's written request, Rupert will return or delete Confidential Information, except copies kept in routine backups or as required by law, which remain subject to this Agreement.

**8. Rupert's own property.** Nothing in this Agreement limits Rupert's use of its own investor and fund database, investor contact details, methods, templates and general know-how, or anonymized, aggregated data that does not identify Client. Information about funds and the people at them that Rupert holds or finds is Rupert's, not Client's Confidential Information.

**9. Term.** Rupert's obligations last for 3 years from the Effective Date, and for trade secrets for as long as they remain trade secrets.

**10. Liability and disputes.** Rupert's liability under this Agreement is subject to the limits of liability in the Service Order. Any dispute under this Agreement is resolved under the disputes section of the Service Order, except that either party may seek an injunction in court to protect its confidential information.

**11. General.** No license is granted. This Agreement is governed by California law. If it conflicts with the Service Order on the confidentiality of Client's information, this Agreement controls; on all other subjects, including liability and disputes, the Service Order controls. Notices may be sent to ${CLIENT_TOKENS.signer_email} for Client and dori@heyrupert.com for Rupert. This Agreement may be signed electronically.
`;
