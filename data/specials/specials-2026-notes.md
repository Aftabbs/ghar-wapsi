# specials-2026: notes

Verified on 2026-10-17. There are 113 rows in `specials-2026.csv`, one per train-number direction. Each row cites an official zonal-railway press release URL that was fetched and that names the train number. No row comes from an aggregator or news site.

## Method and caveats
- **SWR press releases are images.** The pages at `swr.indianrailways.gov.in` (`view_detail.jsp`) embed the release text as an inline image. I read the image and transcribed it by eye. The one exception is PR No.188 (02811/02812), which is plain text.
- **NR timetables have no day column.** For these I counted midnight crossings in the full station table to get `arrival_day_offset`. The rows say so in `notes`.
- **Station codes.** NR notices print station codes, and I used them as printed. SWR, CR, WR, SCR, SER and SR notices print station names only. For those rows I used the standard IR codes, and the row's `notes` say so. Codes I used: SMVB, YPR, YNK, RPAN, SHC, HTE, NTSK, SFG, UBL, MFP, BBS, KIR, MLDT, CNB, PRYJ, SRC, CSMT, GKP, LTT, MAU, BSBS (Banaras), BSB, HDP, GCT, SPJ, DNR, SLN, MMCT, UDN, AYC, HYB, CHZ, BAM, SSM, PNBE, MS, MSB, TBM.
- **Blank fields mean the notice did not give the value.** Times are blank for extension-only notices: 02811/02812, 04131/04132, 04149/04150, 04089/04090, the WR 09xxx rows, 07041/07042 and 03253-03255. For 06565/06566 and 06571/06572 the notice gave only part of the timings.
- **`run_days` derived from dates.** For 02811/02812, 04131/04132 and 04149/04150 the notice gives dates but no weekday. I worked out the weekday from the notified dates, and the row says so in `notes`.
- **Checks run.** A script checked every `first_run` and `last_run` date against `run_days`, and found no mismatches.
- **NTES was not usable.** `enquiry.indianrail.gov.in/mntes` requires an interactive session and captcha, so I did not use it to fill blanks.

## Sources fetched (official)
### South Western Railway (SWR)
- Press release index: https://swr.indianrailways.gov.in/view_section.jsp?lang=0&id=0,4,268
- Releases used (`dcd=` id: subject):
  - 9724: SMVT Bengaluru-Rangapara North
  - 9682: Santragachi-Yelahanka
  - 9674: Yesvantpur-Saharsa
  - 9650: Hatia-SMVT Bengaluru
  - 9630: New Tinsukia-SMVT Bengaluru
  - 9538: Subedarganj-Yesvantpur
  - 9672: Hubballi-Muzaffarpur
  - 9522: Bhubaneswar-Yesvantpur extension
  - 9604: Yesvantpur-Katihar and SMVT-Malda Town extension, with revised timings
  - 9558: extension of 04113/04114, 04149/04150 and 04131/04132
- Full URLs are in the CSV `source_url` column.

### Northern Railway (NR)
- Press release index: https://nr.indianrailways.gov.in/view_section.jsp?lang=0&id=0,4,268
- Releases used: `dcd=` 13060, 13070, 13072, 13074 (Hindi), 13108, 13128, 13134, 13170, 13220, 13246.
- PDF for 04098/04097: https://nr.indianrailways.gov.in/uploads/files/1790247343405-Festival%20Special.pdf
- Fetched but not used, because they cover Katra, Rajasthan or Punjab routes outside scope: 13264, 13242, 13244, 13208, 13200, 13196, 13180, 13186, 13144.

### Central Railway (CR)
- Press release index: https://cr.indianrailways.gov.in/view_section.jsp?lang=0&id=0,4,268
- Releases used:
  - `dcd=11066`: PR 2026/09/45, 418 trains
  - `dcd=11076`: PR 2026/09/52, 162 additional trains
  - `dcd=11036`: PR 2026/09/29

### Western Railway (WR)
- `dcd=8479`: PR 2026/09, extension of 9 pairs.

### South Central Railway (SCR)
- Press release index: https://scr.indianrailways.gov.in/view_section.jsp?lang=0&id=0,5,268
- Releases used: PR 409, 394, 412, 357.
- PR 426 was used only to cross-check 06581/06582.
- Also read: PR 448, 447, 444, 427, 405.

### South Eastern Railway (SER)
- Press release index: https://ser.indianrailways.gov.in/view_section.jsp?lang=0&id=0,4,423
- Releases used: `dcd=9257` (08609/08610, and a cross-check of 08637/08638) and `dcd=9293` (cross-check of 04094/04093).

### Southern Railway (SR)
- Press release index: https://sr.indianrailways.gov.in/view_section.jsp?lang=0&id=0,4,268
- Releases used: PR 445 (`dcd=20658`) and PR 423 (`dcd=20606`).
- PR 412 (`dcd=20564`) was used only to cross-check 05951/05952.

### Eastern Railway (ER)
- PR 2026/10/62 (`dcd=11406`): Malda Town-Shakurbasti, used to cross-check 03439/03440.

### Zones with nothing usable
- **ECR (Hajipur).** `view_section.jsp?id=0,4,268` redirects to the home page, and the home page shows no press-release link. Nothing was obtained, which is a gap for Bihar-origin data.
- **ECoR.** The site did not respond.
- **NFR.** The press list has no 2026 festival items.
- **NER, NWR, WCR.** The press lists had no festival-special titles matched by keyword.
- **NCR.** The press list showed only summer specials from earlier in the year.
- **PIB.** No pib.gov.in release on 2026 festival specials turned up in search.
- **X/Twitter.** Not attempted; posts cannot be read without login.

## Trains seen only on aggregators/news (NOT verified, not in CSV)
- **04131/04132 Kanpur Central-SMVT Bengaluru.** Businesstoday and other news sites give departure times of 16:30 and 07:10. The SWR notice gives dates only, so the CSV has the dates and leaves the times blank.
- **03251/03252 Danapur-SMVT Bengaluru.** Patna Press describes these as a regular special that may be converted to a daily express from September 2026. No official 2026 festival notice found.
- **08520/08519 Puri-Danapur Chhath special.** Patna Press, undated. Not found on an official site.
- **04122/04121 Charlapalli-Prayagraj weekly.** Native Planet via hindutone.com. Not found in the SCR or NR lists I fetched.
- **07191/07192 Charlapalli-Sengottai.** An SR release with this title exists (`dcd=20538`), but I did not fetch it, and the route is out of scope.
- **07711/07712 Secunderabad-Sirpur Kaghaznagar.** SCR PR 431 has this title. The route is intra-Telangana and out of scope.

## Conflicts and oddities
- **CR release dates.** CR PR 2026/09/45 and 2026/09/52 are listed on the index with date 06-10-2026. The body text says "September 25, 2026" and "September 30, 2026". The train data does not depend on which date is correct.
- **Monsoon timings in CR PR 2026/09/45.** Entry (9), 01179/01180, says "monsoon timings" apply on 09.10 and 16.10, and "non-monsoon" from 23.09. These dates overlap. That train is out of scope and not in the CSV.
- **Cross-checks that agree.** These were checked across two official sources and match:
  - 06581/06582: SWR and SCR
  - 08637/08638: SWR and SER
  - 05951/05952: SWR and SR
  - 03439/03440: NR and ER
  - 04094/04093: NR and SER
- **Rows already completed.** 03439, 04094 and 04093 had already run by 2026-10-17. They are kept because their notices are verified.
- **Partly completed rows.** The 08063/08064 Santragachi-Yelahanka pair has its last runs on 19.10 and 21.10.
- **Scope notes.**
  - 04135/04136 Subedarganj-Yesvantpur is described in its notice as being for "extra rush" and runs from September to December. It may not be a festival-only special.
  - 02811/02812 likewise says only "extra rush".
  - 08063/08064 starts or terminates at Yelahanka (YNK), a Bengaluru suburban station that is not in the requested list (SBC/SMVB/YPR/BNC/KJM).

## Biggest gaps
- **No official Bengaluru-origin special found** to Danapur, Patna, Gorakhpur, Muzaffarpur or Darbhanga. The Bihar options from Bengaluru are YPR-Saharsa and YPR-Katihar (partial timings only).
- **No ECR or ECoR notices** were obtainable.
- **No Ahmedabad, Delhi-NZM-to-Bihar, or Chennai-to-Bihar specials** were found.
- **WR (Udhna/Mumbai Central) rows have no timings.**
- **No Bengaluru specials to Assam/Bengal beyond those listed:** Rangapara North, New Tinsukia, Malda Town and Santragachi-Yelahanka.
