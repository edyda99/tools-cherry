# 2026 W-2 Box Decoder + No-Tax-on-Tips Occupation Checker — Sourced Spec

**Tool slug (proposed):** `/w2-box-decoder/` (decoder + embedded TTOC lookup as one page; TTOC lookup optionally also standalone at `/tipped-occupation-lookup/` with cross-links both ways)
**Status:** RESEARCH-ONLY spec. No code written. This merges two previously separate roadmap items (W-2 box decoder; TTOC occupation checker) into one build because they share the same underlying data (Box 12 code TP triggers Box 14b, which is the TTOC list) and the same audience/timing (W-2 season, Jan–Feb).
**Prepared:** 2026-07-12. Every claim below was checked directly against primary sources fetched in this session — not against secondary summaries or prior-knowledge assumptions.
**Ship-before date:** well before December 2026, so both pages are indexed ahead of the Jan–Feb 2027 W-2 search spike (people search "what does box 12 code TP mean" etc. as soon as W-2s land).

---

## 0. Plain-language summary (read this first)

Starting with **tax year 2026 W-2s** (the ones employees receive in January 2027), the form has three brand-new Box 12 codes and a split Box 14:

- **Code TA** = money your employer put into a new "Trump account" (a retirement account for a child under 18) on your behalf. This money is **not taxed** — it's already excluded from your Box 1 wages.
- **Code TP** = the total cash tips you reported to your employer. This is **still fully taxed** as wages (it's already inside Box 1) — TP is just a flag so you know how much of your wages you can deduct on your tax return under the new "no tax on tips" rule.
- **Code TT** = the overtime "premium" (just the extra half of time-and-a-half, not the whole overtime paycheck) you earned. Also **still fully taxed** and already inside Box 1 — TT flags the amount you can deduct under the new "no tax on overtime" rule.
- **Box 14a** = the old "Box 14 — Other" catch-all, renamed. **Box 14b** = brand new: a code (or two) identifying your occupation for tip-deduction purposes, e.g. "101" for bartender.

**The one asymmetry that matters most:** TA reduces your taxable wages up front (excluded from Box 1). TP and TT do **not** — your Box 1 wages already include the full tip and overtime amounts; the deduction happens later, when you file, on Schedule 1-A. A W-2 decoder that tells someone "your wages are lower because of TP/TT" would be **wrong**.

The occupation-lookup half of the tool exists because the "no tax on tips" deduction only applies if your job is on a specific IRS list of 71 occupations (8 categories) that the Treasury finalized in April 2026. Box 14b is literally that list's numeric code. A user who sees "603" in Box 14b, or wants to check before filing whether their job qualifies, needs a searchable version of that list — that's the second half of this tool.

---

## 1. Primary sources fetched and read directly this session

| # | Source | What it anchors |
|---|---|---|
| S1 | **2026 General Instructions for Forms W-2 and W-3** (IRS, revision year confirmed "2026" from the page's own `<h1>`) | Box 12 codes TA/TP/TT verbatim definitions; Box 1 inclusion rules; Box 14a/14b split; "What's New" narrative | `https://www.irs.gov/instructions/iw2w3` |
| S2 | **Federal Register, Vol. 91, No. 70 (Monday, April 13, 2026), pp. 19026–19035** — "Occupations That Customarily and Regularly Received Tips; Definition of Qualified Tips," Doc. **2026-07104**, TD 10044, RIN 1545-BR63 | Final rule preamble; the 3 occupations added between proposed and final; rejected-occupation examples; effective/applicability dates | `https://www.federalregister.gov/documents/2026/04/13/2026-07104/...` (also fetched as raw PDF from `https://www.govinfo.gov/content/pkg/FR-2026-04-13/pdf/2026-07104.pdf`) |
| S3 | **26 CFR § 1.224-1**, codified text including **Table 1 to paragraph (h)** — fetched from eCFR (the authoritative post-codification text, which is what actually governs, vs. the FR preamble prose) | The complete, final TTOC table: 8 categories, 71 occupations, each with code, title, description, illustrative examples, and related SOC code | eCFR renderer, section `1.224-1` |

Where S2 (preamble narrative) and S3 (codified regulation) could conceivably drift, **S3 is treated as the source of record** for the table itself, since eCFR reflects the final codified text as currently in effect; S2 is used for the legislative/rulemaking history (what changed between proposed and final, why certain occupations were rejected).

---

## 2. Box 12 codes TA / TP / TT — verified verbatim, with the Box 1 asymmetry confirmed

### 2.1 Code TA — Trump account employer contributions

> **Code TA—Employer contributions under a section 128 Trump account contribution program paid to a Trump account of an employee or a dependent of an employee.** (Forms W-2AS, W-2CM, W-2GU, or W-2VI should check with the respective territory for applicability.)

Detail paragraph (S1): *"Beginning July 4, 2026, employers may contribute up to $2,500 a year, toward the $5,000 contribution limit to the Trump account of an employee or of a dependent of an employee, and **the amount will be excluded from the gross income of the employee** if paid pursuant to a Trump account contribution program."*

**Confirmed: TA is EXCLUDED from Box 1.** This is stated twice in S1 — once in the "What's New" section, once in the code-TA detail paragraph — using the identical phrase "excluded from the gross income of the employee." There is no ambiguity here.

### 2.2 Code TP — cash tips reported to employer

> **Code TP—Total amount of cash tips reported to the employer.** (Forms W-2AS, W-2CM, W-2GU, or W-2VI should check with the respective territory for applicability.)

Detail paragraph (S1): *"Report the total amount of cash tips reported to the employer. **Tips are still generally subject to federal income tax withholding** and both the employer share and employee share of social security tax and Medicare tax if the tips received are $20 or more per month. You must also list an occupation code in box 14b—Treasury Tipped Occupation Code(s)."*

Separately, the Box 1 instructions (S1) explicitly list what Box 1 must include: *"Total tips reported by the employee to the employer (not allocated tips)."*

**Confirmed: TP is informational-only. Box 1 still includes the full tip amount.** The word "still" in "tips are still generally subject to federal income tax withholding" is the tell — the instructions are explicitly clarifying that the new code does *not* change how tips are withheld or taxed at the wage-reporting stage. TP exists so the employee (and the IRS, via SSA data-sharing) can see the exact cash-tip figure to carry to Schedule 1-A for the separate deduction. **Do not build a decoder that subtracts TP from Box 1** — that would misrepresent the taxpayer's actual withholding.

### 2.3 Code TT — qualified overtime compensation

> **Code TT—Total amount of qualified overtime compensation.** (Forms W-2AS, W-2CM, W-2GU, or W-2VI should check with the respective territory for applicability.)

Detail paragraph (S1): *"Qualified overtime is compensation that is paid to an individual required under section 7 of the Fair Labor Standards Act (FLSA) of 1938 that is more than the regular rate at which the individual is employed. For example, only the 'half' portion of 'time-and-a-half' compensation would be reported using code TT. **Overtime compensation is still generally subject to federal income tax withholding** and both the employer share and employee share of social security tax and Medicare tax."*

**Confirmed both claims from the task:**
1. **TT reports only the premium ("half") portion**, not the full overtime paycheck — explicit in the instructions' own example.
2. **TT is NOT excluded from Box 1** — the "still generally subject to" phrasing mirrors TP exactly, and there is no "excluded from gross income" language anywhere in the TT paragraph (contrast directly with the TA paragraph, which uses that exact phrase). TT, like TP, is a flag identifying the deductible slice already sitting inside Box 1 — not a subtraction from it.

### 2.4 The asymmetry, stated plainly for the decoder

| Code | Reports | Excluded from Box 1? | What it's for |
|---|---|---|---|
| **TA** | Employer Trump-account contribution | **Yes — excluded.** Never taxed as wages. | Retirement savings for a child under 18; informational for the employee's/dependent's account records. |
| **TP** | Total cash tips reported to employer | **No — fully included.** Withheld and taxed as ordinary wages same as before. | Flags the dollar amount eligible for the "no tax on tips" deduction (Schedule 1-A, IRC §224), claimed separately when filing. |
| **TT** | Qualified overtime premium (the "half," not the full time-and-a-half) | **No — fully included.** | Flags the dollar amount eligible for the "no tax on overtime" deduction, claimed separately when filing. |

This is the single most important — and most commonly mis-stated — fact for the decoder to get right. A wrong answer here ("your overtime is tax-free on your W-2") is a direct comprehension failure for a filer trying to reconcile their paycheck against their W-2, and is exactly the kind of error a competitor page is likely to make from a lazy skim of "no tax on tips/overtime" headlines without reading the actual box-12 instruction text.

---

## 3. Box 14 split — verified verbatim

From the "What's New" section (S1): *"**Box 14 has been split into box 14a and box 14b.** Information that was reported in box 14—Other will now be reported in **box 14a—Other**. **Box 14b was created to report the Treasury Tipped Occupation Code(s).**"*

Box 14a detail (S1): unchanged catch-all — vehicle lease value, state disability insurance, union dues, uniform payments, health insurance premiums, nontaxable income, educational assistance, minister's parsonage allowance, certain pension-plan contributions/USERRA make-up amounts, and (for railroad employers) RRTA figures.

Box 14b detail (S1), **verbatim and load-bearing for the decoder logic**:

> *"Use this box to report the Treasury Tipped Occupation Code(s) if cash tips are reported in box 12 with code TP. Enter up to two code(s) based on the occupation(s) that the tips were received in. **If tips were received in more than two occupations, include the Treasury Tipped Occupation Code for any two of the three or more occupations** in which tips were received. **If any tips were received in a nonqualifying occupation, then "000" must be input as one of the occupation code(s).** See IRS.gov/TippedOccupations for the applicable code(s)."*

Decoder implications:
- Box 14b only appears/matters when Box 12 has code TP.
- Up to **2** codes max — a worker with 3+ tipped roles in the year only sees 2 of them; the decoder should note this cap rather than imply 14b is exhaustive.
- **Code "000"** appearing in 14b is itself meaningful: it means at least some of the reported tips came from a job **not** on the TTOC list, i.e. not all of the TP amount is eligible for the deduction. The decoder should explicitly explain this, since a filer seeing "000" next to a real code might otherwise be confused rather than reading it as "partial ineligibility flag."

Confirmed also (minor, non-load-bearing context): Box 9 was physically shrunk on the redesigned form to make room for the added box-14a line (S1, "Changes to boxes 9 and 14a on the 2026 Forms W-2...").

---

## 4. Federal Register final rule (Doc. 2026-07104) — verified

- **Title:** "Occupations That Customarily and Regularly Received Tips; Definition of Qualified Tips"
- **Agency:** Treasury Department / IRS. **Action:** Final rule. **TD 10044. RIN 1545-BR63.**
- **Published:** Federal Register, Vol. 91, No. 70, **Monday, April 13, 2026**, pages 19026–19035.
- **Effective date** (per the document's own DATES line, page 19026): *"These final regulations are effective on **June 12, 2026**."*
- **Applicability date:** the codified regulation (26 CFR § 1.224-1(j), confirmed via eCFR) states: *"This section applies to **taxable years beginning after December 31, 2024**."* — i.e., the list applies retroactively to the 2025 tax year forward (matching the statutory window of the underlying deduction, tax years 2025–2028 per OBBBA §70201/IRC §224(h)).
- **⚠ Discrepancy worth flagging (see §8 open uncertainties):** the task brief described this as "effective April 13, 2026." That is actually the **publication date**, not the effective date. The regulation's own effective date is June 12, 2026 (60 days after publication, standard for Treasury final rules); the substantive applicability (which tax years it governs) is Jan 1, 2025 onward. All three dates are real and distinct — use "effective April 13, 2026" nowhere in the tool's copy; it is not what the primary source says.
- **Underlying statute:** OBBBA (P.L. 119-21) §70201, adding new **IRC §224** — deduction up to $25,000/year for "qualified tips" received in a listed occupation, for tax years 2025–2028, phasing out $100 per $1,000 of MAGI over $150,000 single / $300,000 joint.
- **Rulemaking history confirmed directly from the preamble (S2, pp. 19026–19028):** proposed rule published **Sept 22, 2025** (90 FR 45340), public hearing held telephonically Oct 23, 2025, 322 comment letters received; final rule reflects revisions from that comment period.

### 4.1 The 3 occupations added between proposed (Sept 2025) and final (April 2026) — confirmed directly from the preamble text

All three are explicitly documented as **new** in the final rule, each with the exact final regulatory language quoted from the preamble (S2, p. 19032):

1. **Visual Artists — TTOC 509.** *"The final regulations include the new category of 'Visual Artists (TTOC 509)' ... individuals who create original visual artwork using any of a wide variety of media and techniques. Examples include ice sculptor and caricature sketch artist."* (Proposed rule had considered but rejected a broader "artists/artisans" category; final rule created this narrower one in response to comments specifically about florists/artists.)
2. **Floral Designers — TTOC 510.** *"The Treasury Department and the IRS determined that the data for florist-related occupations listed on individual income tax returns supports adding a new TTOC for 'Floral Designers' (TTOC 510), which encompasses a wider variety of floral workers."* (The related SOC code 27-1023 was moved from the "Private Event Planners" category to this new standalone category.)
3. **Gas Pump Attendants — TTOC 810.** *"The Treasury Department and the IRS reviewed tip-related income tax return data for gas pump attendants located in New Jersey and Oregon, the two States that currently prohibit customers from pumping their own gas ... Based on this data, the final regulations include a new TTOC for 'Gas Pump Attendants,' which applies to all individuals who pump gas for customers at a gas station and may also clean the windshield, check the oil level, or check the tire pressure of the customer's car in conjunction with the car being refueled."*

**Flag confirmed:** any source (including any pre-April-2026 draft content, third-party "TTOC list" articles dated before April 13, 2026, or anything built off the Sept 2025 proposed rule / 90 FR 45340) that does **not** include codes 509, 510, and 810 is citing the stale proposed list, not the final one.

### 4.2 Occupations considered and explicitly rejected (useful for "not found" test cases and FAQ copy)

Directly from the preamble (S2, pp. 19032–19033), the Treasury Department/IRS considered and **did not** include, for lack of supporting tip-income data:

- Chiropractors, accountants, tax preparers, clergy members (as a general category — *"clergy may receive tips in an event setting such as a wedding or funeral"* and are covered only via the existing **Event Officiants (TTOC 505)** category, not as their own clergy category), concert merchandise sellers, and "low bono" legal service providers.
- A general "retail cashier" category — the data showed self-identified "cashiers" who received tips were actually working in roles already captured by **Fast Food and Counter Workers (107)** or **Hotel, Motel, and Resort Desk Clerks (303)**, so no separate, broader "cashier" category was added.
- A broader "table game supervisor" carve-out was requested but the existing **Gambling Dealers (201)** category was confirmed to already cover them (via the related SOC code for First-Line Supervisors of Gambling Service Workers).

These make clean, source-backed "not found" test fixtures (§7).

---

## 5. The complete TTOC table — 8 categories, 71 occupations — ready to drop into a JSON data file

Confirmed count: **71 occupations across 8 categories** (matches the "70+" figure in the task brief). Source: codified **26 CFR § 1.224-1, Table 1 to paragraph (h)**, fetched from eCFR. Every code, title, description, illustrative-examples string, and related SOC code below is quoted/transcribed directly from that table — nothing paraphrased or inferred.

**Proposed JSON shape** (`src/data/ttoc-occupations.json` or similar):

```json
{
  "source": "26 CFR 1.224-1, Table 1 to paragraph (h)",
  "sourceUrl": "https://www.ecfr.gov/current/title-26/chapter-I/subchapter-A/part-1/subject-group-ECFR3b0a1e1e2b3e3e0/section-1.224-1",
  "finalRuleDoc": "Federal Register Doc. 2026-07104, 91 FR 19026 (Apr. 13, 2026), effective June 12, 2026",
  "applicableTaxYears": "beginning after December 31, 2024 (through 2028 per IRC 224(h))",
  "categories": [
    {
      "name": "Beverage and Food Service",
      "occupations": [
        {"code": "101", "title": "Bartenders", "description": "Mix and serve drinks or other refreshments to patrons, directly or through waitstaff", "examples": "Barkeep, mixologist, taproom attendant, sommelier", "soc": "35-3011"},
        {"code": "102", "title": "Wait Staff", "description": "Take orders and serve food and beverages to patrons at tables in dining establishments or at catered events", "examples": "Cocktail waitress, dining car server, banquet staff", "soc": "35-3031"}
      ]
    }
  ]
}
```

Full data, flat table form (all 71 rows — category boundaries marked):

| Code | Category | Title | Description | Illustrative examples | Related SOC code |
|---|---|---|---|---|---|
| 101 | Beverage and Food Service | Bartenders | Mix and serve drinks or other refreshments to patrons, directly or through waitstaff | Barkeep, mixologist, taproom attendant, sommelier | 35-3011 |
| 102 | Beverage and Food Service | Wait Staff | Take orders and serve food and beverages to patrons at tables in dining establishments or at catered events | Cocktail waitress, dining car server, banquet staff | 35-3031 |
| 103 | Beverage and Food Service | Food or Beverage Servers, Non-restaurant | Serve food or beverages to individuals outside of a restaurant environment, such as in hotel rooms, residential care facilities, or cars | Room service food server, boat hop, beer cart server | 35-3041 |
| 104 | Beverage and Food Service | Dining Room and Cafeteria Attendants and Bartender Helpers | Facilitate food service. Clean tables; remove dirty dishes; replace soiled table linens; set tables; replenish supply of clean linens, silverware, glassware, and dishes; supply service bar with food; and serve items such as water, condiments, and coffee to patrons | Bar back, bar helper, busser | 35-9011 |
| 105 | Beverage and Food Service | Chefs and Cooks | Direct and may participate in the preparation, seasoning, and cooking of salads, soups, fish, meats, vegetables, desserts, or other foods | Executive chef, pastry chef, sous chef, fast food cook, private chef, restaurant cook, saucier, food truck cook, banquet cook, caterer, chocolatier, confectioner | 35-1011, 35-2011, 35-2013, 35-2014, 35-2019 |
| 106 | Beverage and Food Service | Food Preparation Workers | Perform a variety of food preparation duties other than cooking, such as preparing cold foods and shellfish, slicing meat, and brewing coffee or tea | Salad maker, sandwich maker, fruit and vegetable parer, kitchen steward | 35-1012, 35-2021, 35-9099 |
| 107 | Beverage and Food Service | Fast Food and Counter Workers | Serve customers at counter or from a steam table. Perform duties such as taking orders and serving food and beverages. May take payment. May prepare food and beverages | Barista, ice cream server, cafeteria server | 35-3023 |
| 108 | Beverage and Food Service | Dishwashers | Clean dishes, kitchen, food preparation equipment, or utensils | Dish room worker, silverware cleaner | 35-9021 |
| 109 | Beverage and Food Service | Host Staff, Restaurant, Lounge, and Coffee Shop | Welcome patrons, seat them at tables or in lounge, and help ensure quality of facilities and service | Maître d'hôtel, dining room host | 35-9031 |
| 110 | Beverage and Food Service | Bakers | Mix and bake ingredients to produce breads, rolls, cookies, cakes, pies, pastries, or other baked goods | Bread baker, cake baker, bagel baker, pastry finisher | 51-3011 |
| 201 | Entertainment and Events | Gambling Dealers | Operate gambling games. Stand or sit behind table and operate games of chance by dispensing the appropriate number of cards or blocks to players or operating other gambling equipment. Distribute winnings or collect players' money or chips. May compare the house's hand against players' hands | Blackjack dealer, craps dealer, poker dealer, roulette dealer, pit clerk | 39-3011, 39-1013 |
| 202 | Entertainment and Events | Gambling Change Persons and Booth Cashiers | Exchange coins, tokens, and chips for patrons' money. May issue payoffs and obtain customer's signature on receipt. May operate a booth in the slot machine area and furnish change persons with money bank at the start of the shift, or count and audit money in drawers | Slot attendant, mutuel teller | 41-2012 |
| 203 | Entertainment and Events | Gambling Cage Workers | In a gambling establishment, conduct financial transactions for patrons. Accept patron's credit application and verify credit references to provide check-cashing authorization or to establish house credit accounts. May reconcile daily summaries of transactions to balance books. May sell gambling chips, tokens, or tickets to patrons, or to other workers for resale to patrons. May convert gambling chips, tokens, or tickets to currency upon patron's request. May use a cash register or computer to record transaction | Casino cashier, cage cashier | 43-3041 |
| 204 | Entertainment and Events | Gambling and Sports Book Writers and Runners | Post information enabling patrons to wager on various races and sporting events. Assist in the operation of games such as keno and bingo. May operate random number-generating equipment and announce the numbers for patrons. Receive, verify, and record patrons' wagers. Scan and process winning tickets presented by patrons and pay out winnings for those wagers | Betting runner, bingo worker, keno runner, race book writer | 39-3012 |
| 205 | Entertainment and Events | Dancers | Perform dances | Club dancer, dance artist | 27-2031 |
| 206 | Entertainment and Events | Musicians and Singers | Play one or more musical instruments or sing | Instrumentalist, accompanist, lounge singer | 27-2042 |
| 207 | Entertainment and Events | Disc Jockeys, Except Radio | Play prerecorded music for live audiences at venues or events such as clubs, parties, or wedding receptions. May use techniques such as mixing, cutting, or sampling to manipulate recordings. May also perform as emcee (master of ceremonies) | Deejay, club DJ | 27-2091 |
| 208 | Entertainment and Events | Entertainers and Performers | Entertain audiences with artistic expression | Comedian, clown, magician, street performer | 27-2099 |
| 209 | Entertainment and Events | Digital Content Creators | Produce and publish on digital platforms original entertainment and personality-driven content, such as live streams, short-form videos, or podcasts | Streamer, online video creator, social media influencer, podcaster | 27-2099 |
| 210 | Entertainment and Events | Ushers, Lobby Attendants, and Ticket Takers | Assist patrons at entertainment events by performing duties, such as collecting admission tickets and passes from patrons, assisting in finding seats, searching for lost articles, and helping patrons locate such facilities as restrooms and telephones | Ticket collector, theater usher | 39-3031 |
| 211 | Entertainment and Events | Locker Room, Coatroom, and Dressing Room Attendants | Provide personal items to patrons or customers in locker rooms, dressing rooms, or coatrooms | Coat checker, washroom attendant, bathhouse attendant | 39-3093 |
| 301 | Hospitality and Guest Services | Baggage Porters and Bellhops | Handle baggage for travelers at transportation terminals or for guests at hotels or similar establishments | Hotel baggage handler, curbside airport check-in assistant, doorman | 39-6011 |
| 302 | Hospitality and Guest Services | Concierges | Assist patrons at hotels or apartment buildings with personal services. May take messages; arrange or give advice on transportation, business services, or entertainment; or monitor guest requests for housekeeping and maintenance | Hotel guest service agent, activities concierge | 39-6012 |
| 303 | Hospitality and Guest Services | Hotel, Motel, and Resort Desk Clerks | Accommodate hotel, motel, and resort patrons by registering and assigning rooms to guests, issuing room keys or cards, transmitting and receiving messages, keeping records of occupied rooms and guests' accounts, making and confirming reservations, and presenting statements to and collecting payments from departing guests | Front desk clerk, registration clerk | 43-4081 |
| 304 | Hospitality and Guest Services | Maids and Housekeeping Cleaners | Perform any combination of light cleaning duties to maintain commercial establishments, such as hotels, in a clean and orderly manner. Duties may include making beds, replenishing linens, cleaning rooms and halls, and vacuuming | Hotel maid, housekeeping staff | 37-2012 |
| 401 | Home Services | Home Maintenance and Repair Workers | Perform work to keep machines, mechanical equipment, or the structure of a building in repair. May maintain and repair musical instruments, furniture, antiques, and non-fixtures | Handyman, roofer, window repairer, house painter (interior or exterior), flooring installer, piano tuner, furniture restorer, antique repairer | 49-9071, 49-9098, 49-9099, 49-9063, 49-2097, 51-7021 |
| 402 | Home Services | Home Landscaping and Groundskeeping Workers | Landscape or maintain grounds of property using hand or power tools or equipment. Workers typically perform a variety of tasks, which may include any combination of the following: sod laying, mowing, trimming, planting, watering, fertilizing, digging, raking, sprinkler installation, and installation of mortarless segmental concrete masonry wall units | Lawn mower, gardener, tree trimmer, weed sprayer | 37-3011 |
| 403 | Home Services | Home Electricians | Install, maintain, and repair electrical wiring, equipment, and fixtures. Ensure that work is in accordance with relevant codes. May install or service exterior lights, intercom systems, or electrical control systems | Electrician | 47-2111 |
| 404 | Home Services | Home Plumbers | Assemble, install, alter, and repair pipelines or pipe systems that carry water, steam, air, or other liquids or gases. May install heating and cooling equipment and mechanical control systems | Plumber, pipefitter, steamfitter, sprinkler installer | 47-2152 |
| 405 | Home Services | Home Heating and Air Conditioning Mechanics and Installers | Install or repair heating, central air conditioning, HVAC, or refrigeration systems, including oil burners, hot-air furnaces, and heating stoves | Air conditioning repairer, heating system installer, chimney sweep | 49-9021 |
| 406 | Home Services | Home Appliance Installers and Repairers | Repair, adjust, or install all types of electric or gas household appliances, such as refrigerators, washers, dryers, and ovens | Washing machine installer, dishwasher repairer | 49-9031 |
| 407 | Home Services | Home Cleaning Service Workers | Perform any combination of light cleaning duties to maintain private households in a clean and orderly manner. Duties may include making beds, replenishing linens, cleaning rooms and halls, and vacuuming | House cleaner, pool cleaner, carpet cleaner, window washer | 37-2012 |
| 408 | Home Services | Locksmiths | Repair and open locks, make keys, change locks and safe combinations, and install and repair safes | Safe installer, key maker | 49-9094 |
| 409 | Home Services | Roadside Assistance Workers | Provide on-road assistance to drivers whose vehicles have broken down | Tow truck driver, car battery technician, tire repairer, tire changer, car fuel deliverer | 49-3023, 53-3032 |
| 501 | Personal Services | Personal Care and Service Workers | Provide personalized assistance to individuals with disabilities or illness who require help with personal care and activities of daily living support (for example, feeding, bathing, dressing, grooming, toileting, and ambulation). May also provide help with tasks such as preparing meals, doing light housekeeping, and doing laundry. Work is performed in various settings depending on the needs of the care recipient and may include locations such as their home, place of work, out in the community, at a daytime nonresidential facility, or a residential facility | Elderly companion, personal care aide, butler, house sitter, personal valet | 31-1122, 39-9099 |
| 502 | Personal Services | Private Event Planners | Coordinate activities of staff or clients to make arrangements for private events. May provide creative design for décor and invitations | Wedding planner, party planner | 13-1121 |
| 503 | Personal Services | Private Event and Portrait Photographers | Photograph people, landscapes, or other subjects. May use lighting equipment to enhance a subject's appearance. May use editing software to produce finished images and prints | Wedding photographer, headshot photographer | 27-4021 |
| 504 | Personal Services | Private Event Videographers | Operate video or film camera to record images or scenes of private events | Wedding videographer | 27-4031 |
| 505 | Personal Services | Event Officiants | Lead and facilitate the ceremony for life events such as weddings or funerals. Ceremonies may be religious or civil services | Wedding officiant, funeral celebrant, clergy, vow renewal officiant | 21-2011 |
| 506 | Personal Services | Pet and Show Animal Caretakers | Feed, water, groom, bathe, exercise, or otherwise provide care to promote and maintain the well-being of pets or show animals | Pet groomer, pet sitter, pet walker, kennel worker, pet trainer, horse groomer | 39-2021 |
| 507 | Personal Services | Tutors | Instruct individual students or small groups of students in academic subjects to supplement formal class instruction or to prepare students for standardized or admissions tests. May provide instruction in person or remotely | Reading tutor, math tutor, language tutor | 25-3041 |
| 508 | Personal Services | Nannies and Babysitters | Attend to children at businesses and private households. Perform a variety of tasks, such as dressing, feeding, bathing, and overseeing play | Au pair, child sitter at hotels and gyms | 39-9011 |
| **509** | Personal Services | **Visual Artists** *(added in final rule)* | Create original visual artwork using any of a wide variety of media and techniques | Ice sculptor, caricature sketch artist | 27-1013 |
| **510** | Personal Services | **Floral Designers** *(added in final rule)* | Design, cut, and arrange live, dried, or artificial flowers and foliage | Corsage maker, florist, flower arranger, event florist | 27-1023 |
| 601 | Personal Appearance and Wellness | Skincare Specialists | Provide skincare treatments to face and body to enhance an individual's appearance | Facialist, electrologist, spa esthetician | 39-5094 |
| 602 | Personal Appearance and Wellness | Massage Therapists | Perform therapeutic massages of soft tissues and joints. May assist in the assessment of range of motion and muscle strength or propose client therapy plans | Masseuse, deep tissue massage therapist, sports massage therapist | 31-9011 |
| 603 | Personal Appearance and Wellness | Barbers, Hairdressers, Hairstylists, and Cosmetologists | Provide beauty or barbering services, such as cutting, coloring, and styling hair, massaging and treating scalps, trimming beards or giving shaves | Wig stylist, beautician, hair colorist, hair cutter | 39-5012, 39-5011 |
| 604 | Personal Appearance and Wellness | Shampooers | Shampoo and rinse customers' hair | Scalp treatment specialist, shampoo assistant | 39-5093 |
| 605 | Personal Appearance and Wellness | Manicurists and Pedicurists | Clean and shape customers' fingernails and toenails. May polish or decorate nails | Nail technician, fingernail sculptor, nail painter | 39-5092 |
| 606 | Personal Appearance and Wellness | Eyebrow and Eyelash Technicians | Enhance and maintain clients' eyebrows using techniques such as threading, waxing, or tweezing. Enhance clients' eyelashes using techniques such as tinting or applying extensions | Eyebrow waxer | 39-5012 |
| 607 | Personal Appearance and Wellness | Makeup Artists | Design and apply makeup looks | Wedding makeup artist, party makeup artist | 39-5091 |
| 608 | Personal Appearance and Wellness | Exercise Trainers and Group Fitness Instructors | Instruct or coach groups or individuals in exercise activities for the primary purpose of personal fitness. Demonstrate techniques and form, observe participants, and explain to them corrective measures necessary to improve their skills. Develop and implement individualized approaches to exercise | Aerobics trainer, yoga instructor, personal trainer | 39-9031 |
| 609 | Personal Appearance and Wellness | Tattoo Artists and Piercers | Design and execute tattoos on a client's skin, often using a needle and ink. Create openings in the human body for the insertion of jewelry. May consult clients on aftercare to promote healing and prevent infection | Tattoo artist, ear piercer, nose piercer | 27-1019 |
| 610 | Personal Appearance and Wellness | Tailors | Design, make, alter, repair, or fit garments | Tailor, seamstress, clothing alterations worker | 51-6052 |
| 611 | Personal Appearance and Wellness | Shoe and Leather Workers and Repairers | Construct, decorate, or repair leather and leather-like products, such as luggage, shoes, and saddles. May use hand tools | Cobbler, shoe shiner | 51-6041 |
| 701 | Recreation and Instruction | Golf Caddies | Assist a golfer during a round of golf by providing practical support and strategic advice. May carry the golfer's bag, manage their clubs, offer guidance on club selection or course strategy | Golf caddie, golf cart attendant | 39-3091 |
| 702 | Recreation and Instruction | Self-Enrichment Teachers | Teach or instruct individuals or groups for the primary purpose of self-enrichment, rather than for an occupational objective, educational attainment, competition, or fitness | Knitting instructor, piano teacher, art instructor, dance teacher | 25-3021 |
| 703 | Recreation and Instruction | Recreational and Tour Pilots | Pilot and navigate the flight of fixed-wing aircraft, helicopters, or other airborne vehicle for recreational or touring purposes. Excludes regional, national, and international airline pilots, and emergency services pilots | Helicopter tour pilot, hot air balloon aeronaut, skydiving pilot | 53-2012 |
| 704 | Recreation and Instruction | Tour Guides | Guide individuals or groups on sightseeing tours or through places of interest, such as industrial establishments, public buildings, and art galleries | Museum guide, sightseeing guide | 39-7011 |
| 705 | Recreation and Instruction | Travel Guides | Plan, organize, and conduct long-distance travel, tours, and expeditions for individuals and groups (covering both indoor and outdoor locations) | Cruise director, river expedition guide | 39-7012 |
| 706 | Recreation and Instruction | Sports and Recreation Instructors | Teach or instruct individuals or groups for the primary purpose of recreation, rather than for an occupational objective, educational attainment, competition, or fitness | Diving instructor, ski instructor, tennis teacher, surfing instructor | 25-3021 |
| 801 | Transportation and Delivery | Parking and Valet Attendants | Park vehicles or issue tickets for customers in a parking lot or garage. May park or tend vehicles in environments such as a hotel or restaurant. May collect fee | Parking garage attendant, valet parker | 53-6021 |
| 802 | Transportation and Delivery | Taxi and Rideshare Drivers and Chauffeurs | Drive a motor vehicle to transport passengers on a planned or unplanned basis | Cab driver, personal driver, platform/app-based rideshare driver | 53-3054 |
| 803 | Transportation and Delivery | Shuttle Drivers | Drive a motor vehicle to transport passengers on a planned route and scheduled basis. May collect a fare. Excludes taxi and rideshare drivers, chauffeurs, municipal bus drivers, and school bus drivers | Airport shuttle driver, hotel shuttle driver, rental car shuttle driver | 53-3053 |
| 804 | Transportation and Delivery | Goods Delivery People | Drive truck or other vehicle to deliver goods, such as food products, appliances, or furniture, or pick up or deliver packages. May also take orders or collect payment at point of delivery | Pizza delivery driver, grocery delivery driver, floral delivery, bicycle courier, package delivery person, appliance delivery driver, furniture delivery person, app/platform-based delivery person | 53-3031 |
| 805 | Transportation and Delivery | Personal Vehicle and Equipment Cleaners | Wash or otherwise clean personal vehicles, machinery, and other equipment. Use such materials as water, cleaning agents, brushes, cloths, and hoses | Car wash attendant, auto detailer, boat waxer | 53-7061 |
| 806 | Transportation and Delivery | Private and Charter Bus Drivers | Drive bus or motor coach for charters or private carriage. May assist passengers with baggage | Motor coach bus driver, tour bus driver | 53-3052 |
| 807 | Transportation and Delivery | Water Taxi Operators and Charter Boat Workers | Operate water taxi boats or provide services to passengers on private charter boats. May assist in navigational activities | Water taxi captain, air boat operator, charter boat deckhand, charter boat steward | 53-5022 |
| 808 | Transportation and Delivery | Rickshaw, Pedicab, and Carriage Drivers | Operate rickshaw, pedicab, or carriage to transport passengers | Horse drawn carriage driver, bike taxi driver | 53-6099 |
| 809 | Transportation and Delivery | Home Movers | Manually move furniture, music instruments, art, antiques, boxes, luggage, or other materials to or from a home or dwelling | Furniture mover, packer, piano mover, art mover | 53-7062 |
| **810** | Transportation and Delivery | **Gas Pump Attendant** *(added in final rule)* | Pump gas for customers at a gas station. May also clean the windshield, check the oil level, or check the tire pressure of the customer's car in conjunction with the car being refueled | Gas pumper | 53-6031 |

**Category summary:** Beverage and Food Service (10: 101–110) · Entertainment and Events (11: 201–211) · Hospitality and Guest Services (4: 301–304) · Home Services (9: 401–409) · Personal Services (10: 501–510, includes the 2 additions) · Personal Appearance and Wellness (11: 601–611) · Recreation and Instruction (6: 701–706) · Transportation and Delivery (10: 801–810, includes the 1 addition) = **71 total**.

---

## 6. Decoder logic — what the tool computes and displays

### 6.1 Box 12 code decoder

Input: a set of `{code, amount}` pairs the user copies from their W-2 Box 12 (plus optionally Box 1 and Box 14a/14b, for the fuller "decode my whole W-2" experience).

For each recognized code, output:
- **Plain-language name**
- **Included in Box 1 or not** (only TA is excluded; TP/TT are not)
- **What it's for** (TA: tax-advantaged savings, no action needed by filer beyond confirming the account exists; TP: carry to Schedule 1-A tips deduction; TT: carry to Schedule 1-A overtime deduction)
- **Caveat**: FICA (Social Security/Medicare) still applies to TP and TT amounts regardless of the income-tax deduction — this is a distinct claim (confirmed above: "both the employer share and employee share of social security tax and Medicare tax" for both TP and TT); the deduction is federal-income-tax-only.

This tool does **not** attempt to calculate the actual dollar deduction (that's the existing `/tips-tax-calculator/` and `/overtime-tax-calculator/` job) — it only explains what the codes mean and links to those calculators for the "how much do I actually save" question. Scope discipline: decoder explains, existing calculators compute.

### 6.2 Box 14b / TTOC decoder

If Box 14b contains one or two 3-digit codes:
- Look up each in the TTOC table; display category + title + description.
- If a code is **"000"**: display the specific "nonqualifying occupation" explanation (§3) — some of the reported tips came from work not on the list, so not all of Box 12 TP is deductible.
- If a code is **not found** in the table (data entry error, or a pre-2026 corrected form using an old/placeholder value): show a distinct "code not recognized — check your W-2 for a typo, or ask your employer" message, never silently treat it as "000" or as a match.

### 6.3 Occupation search (the TTOC lookup half)

Input: free-text occupation (e.g., "hairdresser," "uber driver," "server").
Logic: fuzzy match against `title` + `examples` fields (the examples field is essential — most everyday job titles like "barista," "valet," "Uber driver" are in `examples`, not `title`).
Output on match: TTOC code, category, official title, and a "use this code in Box 14b" note for anyone helping fill out a W-2, or "your job qualifies for the tips deduction" framing for an employee checking eligibility.
Output on no match: explicit "not on the IRS list" result — **not** a blank/empty state — with a link to the full browsable list and a plain-language note that tips from a non-listed occupation don't qualify for the federal deduction (though they're still fully taxable as before, nothing changes for a non-qualifying job either way).

---

## 7. Test fixtures (11 cases)

All amounts are illustrative; all logic outcomes are traceable to §2–§6 above.

| # | Scenario | Box 12 inputs | Box 14b input | Expected decoder output |
|---|---|---|---|---|
| **F1** | Full house: TA + TP + TT all present | TA=2,500; TP=9,800; TT=1,150 | 101 | Box 1 wages **already include** the $9,800 TP and $1,150 TT (no adjustment needed/shown); the $2,500 TA is confirmed **excluded** from Box 1 and flagged as "not part of your taxable wages — a Trump account contribution." 14b code 101 decodes to Bartenders (Beverage and Food Service), confirming the $9,800 is deduction-eligible tip income. |
| **F2** | Only TP present (no TA, no TT) | TP=14,200 | 603 | TP fully included in Box 1 (no exclusion). 14b=603 decodes to Barbers/Hairdressers/Hairstylists/Cosmetologists (Personal Appearance and Wellness). Output notes overtime deduction not applicable this year (no TT). |
| **F3** | Only TT present (no tips at all) | TT=2,300 | *(none present — no TP, so no 14b entry expected)* | TT fully included in Box 1. Decoder explicitly states Box 14b is not populated because it only applies "if cash tips are reported in box 12 with code TP" (S1) — absence of 14b here is correct, not an error. |
| **F4** | Only TA present (Trump account only, no tips/OT) | TA=1,800 | *(none)* | $1,800 excluded from Box 1; no tips/overtime deduction applicable this year; decoder shows only the TA explanation. |
| **F5** | Occupation lookup — food & beverage, core category | search: "bartender" | — | Match: code **101**, Beverage and Food Service, exact title "Bartenders." |
| **F6** | Occupation lookup — via illustrative example, not literal title | search: "uber driver" | — | Match via `examples` field ("platform/app-based rideshare driver") → code **802**, Transportation and Delivery, official title "Taxi and Rideshare Drivers and Chauffeurs." |
| **F7** | Occupation lookup — Personal Appearance and Wellness | search: "eyelash tech" | — | Match: code **606**, "Eyebrow and Eyelash Technicians." |
| **F8** | Occupation lookup — one of the 3 final-rule additions (Gas Pump Attendant) | search: "gas station attendant" | — | Match: code **810**, Transportation and Delivery, "Gas Pump Attendant" — with a note this occupation was added in the **final** rule (not present in the Sept 2025 proposed list), sourced to the FR preamble (§4.1). |
| **F9** | Occupation lookup — the other notable final-rule addition (Floral Designers) | search: "florist" | — | Match: code **510**, Personal Services, "Floral Designers" — same "added in final rule" note. |
| **F10** | Occupation lookup — NOT on the list (confirmed rejected in preamble) | search: "retail cashier" | — | **Not found.** Decoder states retail cashiers are not a listed TTOC category; per the final rule preamble, tipped cashiers were determined to actually work in roles already covered by codes 107 (Fast Food and Counter Workers) or 303 (Hotel/Motel/Resort Desk Clerks) — surfaced as a "did you mean" suggestion, but plain "retail cashier" alone returns not-found. |
| **F11** | Occupation lookup — NOT on the list (professional services, confirmed rejected) | search: "accountant" | — | **Not found.** Decoder states accountants were considered and excluded from the final list for lack of supporting tip-income data (§4.2); no deduction eligibility; no suggested alternate code. |

Notes:
- **F3** is the fixture that most directly tests the Box 1/Box 14b asymmetry logic (14b absence is correct behavior, driven by the "if...TP" conditional in the actual instruction text — a naive implementation might wrongly always render a Box 14b section).
- **F1** is the fixture that most directly tests the TA-vs-TP/TT asymmetry in one W-2.
- **F8/F9** double as regression tests against "stale proposed-list" data — any TTOC dataset missing 509/510/810 should visibly fail these two.

---

## 8. Existing Tools Berry content — cross-check finding (flagged separately, not folded into the new build's scope)

Files checked directly: `src/templates/tips-tax-calculator.html`, `src/assets/tips-tax-calculator.js`, `src/templates/w4-overtime-tips-withholding-calculator.html`, `src/assets/w4-overtime-tips-withholding-calculator.js`, `src/templates/data-tips-tax-by-state.html`, `src/content/static-pages.js` (source of the `/tax-glossary/` page).

**Finding: no correction needed — but for a reason worth recording.** None of these existing pages cite the TTOC list, any specific occupation names, or any numeric codes at all. Every reference to "occupation" on the site is generic boilerplate along the lines of:
- *"you must work in an occupation that 'customarily and regularly' receives tips — the Treasury has published the list of qualifying occupations"* (`tips-tax-calculator.html`)
- *"limited to occupations that customarily receive tips"* (`data-tips-tax-by-state.html`)
- The `/tax-glossary/` W-2 entry (`static-pages.js` line 161–162) says only: *"From tax year 2026, qualified tips and overtime appear in their own boxes on the W-2"* — no box numbers, no codes.

So there is nothing on the site today that reflects the **Sept 2025 proposed** list (or any specific occupation/code at all) that would need updating. This is a genuinely clean result, not an oversight in the check: the existing calculators were built deduction-math-first and correctly left "which occupations qualify" as an external, unlinked reference rather than hard-coding a list that could go stale — which, per this research, it would have.

**One live opportunity, not a correction:** `tips-tax-calculator.html` and the W-4 overtime/tips tool both currently link out generically to "the Treasury has published the list" without a link. Once this decoder/TTOC-lookup tool ships, those pages should cross-link to it directly (e.g., "check your occupation" → `/w2-box-decoder/#ttoc-lookup`) — that's a small follow-up cross-link task for the build phase, not a content-correction task now.

---

## 9. Open uncertainties / things not fully verified

1. **Exact final-rule paragraph lettering for the applicability date.** The Federal Register DATES line (S2, p. 19026) cross-references *"§ 1.224-1(i)"* for the applicability date, but the codified eCFR text (S3) places the applicability sentence in **paragraph (j)**, not (i). This is likely just a numbering shift between the FR preamble's internal cross-reference and the final codified lettering (paragraph (g) is `[Reserved]` in the codified version, which could shift subsequent letters) — not a substantive discrepancy, but I could not fully reconcile the two documents' paragraph lettering in the time available. Non-load-bearing: the substantive applicability date itself (tax years after Dec 31, 2024) is stated unambiguously in both documents' prose.
2. **eCFR "current" snapshot timing.** I fetched eCFR's "current" rendering of § 1.224-1, which reflects the version in effect as of the fetch date; eCFR is officially described as not always perfectly real-time with the Federal Register for very recent rules. I did not separately diff the eCFR table against the FR PDF's own printed Table 1 row-by-row (only spot-checked several rows against the FR PDF's preamble prose, e.g. the 509/510/810 additions) — a pre-launch build step should do one final row-count and code-list diff between eCFR and the FR PDF/govinfo.gov copy to be certain no post-publication corrections occurred.
3. **Whether "up to two codes" in Box 14b has any tie-breaking rule for which two occupations to report** when a worker had 3+. The instructions (S1) say "include the Treasury Tipped Occupation Code for any two of the three or more occupations" — "any two" implies employer discretion, with no stated priority (e.g., highest tip amount first). The decoder should not assume or imply a selection rule beyond what's quoted.
4. **State conformity to Box 14b/TTOC specifically** (as opposed to state conformity to the tips deduction generally, which the site's `data-tips-tax-by-state.html` already covers) was not researched in this pass — Box 14b is a federal information-reporting box; whether any state return separately requires it wasn't checked and should be treated as out of scope unless a state explicitly requires it.
5. **The "70+" figure vs. the confirmed 71** — the brief said "70+ occupations total," and the verified codified count is exactly **71**. Stated for precision; not a conflict, just confirming the exact number to hard-code.
6. **SOC code year vintage.** The FR preamble notes the TTOC system is "based on the 2018 Standard Occupation Classification (SOC) Code system" and mentions a pending BLS 2028 SOC revision (comment thread, p. 19029, footnote 6) — the `soc` field in the table above is the 2018-vintage code as codified; if BLS revises SOC codes before 2028, this field could need a future update, but the TTOC codes themselves (the 3-digit numbers that actually go in Box 14b) are Treasury's own system and are not tied to the SOC revision cycle.
