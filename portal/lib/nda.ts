import { CLIENT_TOKENS } from "@/lib/service-order";

// Default NDA: one-way, Rupert is the receiving party. Client tokens are
// filled in by the client when signing, as with the Service Order.
export const DEFAULT_NDA = `# Hey Rupert — Non-Disclosure Agreement

This Non-Disclosure Agreement (this "Agreement") is between The Night Ventures, LLC, a California limited liability company doing business as Hey Rupert ("Rupert"), and ${CLIENT_TOKENS.company_name} ("Client"). It is effective on the date of the last signature (the "Effective Date").

**1. Purpose.** Client will share information with Rupert so that Rupert can provide services under the Service Order between the parties (the "Purpose").

**2. Confidential Information.** "Confidential Information" means non-public information Client discloses to Rupert, in any form, including business plans, financials, metrics, fundraising terms, investor relationships, pitch materials, product and technical information, and customer information.

**3. Exclusions.** Confidential Information does not include information that (a) is or becomes public through no fault of Rupert; (b) Rupert already knew without a duty of confidentiality; (c) Rupert receives from a third party without a duty of confidentiality; or (d) Rupert develops independently without using Client's information.

**4. Rupert's obligations.** Rupert will (a) use Confidential Information only for the Purpose; (b) not disclose it to anyone except its personnel, contractors and service providers who need it for the Purpose and are bound by confidentiality obligations at least as protective as these; and (c) protect it with at least reasonable care. Rupert may use service providers, including AI tools, to process Confidential Information for the Purpose, subject to confidentiality obligations. Sharing Client-approved materials with investors as part of an approved campaign is part of the Purpose.

**5. Required disclosure.** If the law requires Rupert to disclose Confidential Information, Rupert will give Client prompt notice where legally allowed and disclose only what is required.

**6. Return or deletion.** On Client's written request, Rupert will return or delete Confidential Information, except copies kept in routine backups or as required by law, which remain subject to this Agreement.

**7. Rupert's own property.** Nothing in this Agreement limits Rupert's use of its own investor and fund database, methods, templates and general know-how, or anonymized, aggregated data that does not identify Client.

**8. Term.** Rupert's obligations last for 3 years from the Effective Date, and for trade secrets for as long as they remain trade secrets.

**9. General.** No license is granted. Client may seek injunctive relief for a breach. This Agreement is governed by California law. If it conflicts with the Service Order on the confidentiality of Client's information, this Agreement controls; on all other subjects, the Service Order controls. Notices may be sent to ${CLIENT_TOKENS.signer_email} for Client and dori@thenightventures.com for Rupert. This Agreement may be signed electronically.
`;
