// days-from-today.js — the fixed-interval date pages.
//
// One page per interval people actually type into a search box ("60 days from
// today", "12 weeks from today", "10 business days from today", "90 days ago").
// The ANSWER is not in this file and is not in the built HTML: it is computed in
// the reader's browser at page load, because the answer changes every midnight.
// What lives here is the part that does NOT go stale — what the interval is
// commonly used for, and how the count is defined.
//
// Every page carries its own use-case section and its own questions. Nothing in
// here may be a statistic: the facts are durable, checkable definitions (an IRS
// deadline written into the code, a rolling visa window, an accounting ageing
// convention), never a number about how many people do something.
//
// `unit`   'day' | 'week' | 'business'
// `dir`    'fwd' | 'back'
// `uses`   the page's own H2 + prose. At least two blocks, no block reused
//          across pages — the differentiation gate measures this.
// `faq`    three questions that only make sense on this page.

export const DFT_PAGES = [
  // ---------------------------------------------------------------- calendar days
  {
    slug: '7-days-from-today', unit: 'day', amount: 7, dir: 'fwd',
    label: '7 days from today',
    uses: [
      {
        h2: 'A week out lands on the same weekday',
        p: `Seven days is the one interval that never moves the weekday. Because the week is
        exactly seven days long, a Tuesday plus seven days is always a Tuesday, in every month
        and in every year, leap or not. That makes it the safe interval for anything that has
        to keep its slot: a weekly stand-up, a bin collection, a class, a repeat prescription
        pick-up. If the thing you are scheduling depends on the weekday rather than the date,
        seven days is the count you want, and fourteen or twenty-one after that.`
      },
      {
        h2: 'Where a seven-day deadline shows up',
        p: `Short notice periods are usually written in days rather than weeks so there is no
        argument about when the clock started. Seven-day windows are common in short-term
        rental cancellation terms, in "reply within a week" service tickets, and in
        appointment-reminder rules. The wording matters more than the arithmetic: a term that
        says <em>seven days</em> means seven calendar days including the weekend, while
        <em>one week's notice</em> is sometimes read as ending at the same point in the working
        week. When a contract is ambiguous, count both and diary the earlier one.`
      }
    ],
    faq: [
      { q: 'Is 7 days from today always the same day of the week?',
        a: 'Yes. The week is exactly seven days long, so adding seven days always returns the same weekday, with no exceptions for month ends or leap years.' },
      { q: 'Does 7 days from today mean one week from today?',
        a: 'In date arithmetic, yes — one week is defined as seven days, and this page adds seven calendar days to your device\'s current date.' },
      { q: 'Should today count as day one?',
        a: 'Not here. This page treats today as day zero and lands on the seventh day after it. If your contract counts the starting day as day one, subtract one day from the result.' }
    ]
  },
  {
    slug: '10-days-from-today', unit: 'day', amount: 10, dir: 'fwd',
    label: '10 days from today',
    uses: [
      {
        h2: 'Ten days moves the weekday by three',
        p: `Ten days is a week plus three, so the answer always falls three weekdays later than
        today: a Monday becomes a Thursday, a Friday becomes a Monday. It is worth knowing
        before you promise something for "ten days' time", because roughly three in every ten
        starting days push a ten-day deadline onto a weekend, when nobody is there to receive
        whatever you owe.`
      },
      {
        h2: 'Ten-day notices are usually calendar days',
        p: `Ten days is a favourite length for a first, short formal notice — a demand to fix or
        vacate, a payment reminder before a late fee, a deadline to return equipment. Unless
        the document explicitly says <em>business days</em> or <em>working days</em>, a bare
        "ten days" means ten calendar days and the weekend counts. If yours does say business
        days, use the <a href="/10-business-days-from-today/">10 business days from today</a>
        page instead, which skips Saturdays and Sundays and lands two working weeks out.`
      }
    ],
    faq: [
      { q: 'Does a 10-day notice include weekends?',
        a: 'A notice that just says "10 days" is normally counted in calendar days, so weekends are included. Only wording that says business or working days excludes them.' },
      { q: 'What weekday is 10 days from today?',
        a: 'Ten days is one week plus three days, so the result is always three weekdays past today — Monday becomes Thursday, Thursday becomes Sunday.' },
      { q: 'How is this different from 10 business days from today?',
        a: 'Ten business days skips every Saturday and Sunday, so it lands about four days later on the calendar than ten plain days.' }
    ]
  },
  {
    slug: '14-days-from-today', unit: 'day', amount: 14, dir: 'fwd',
    label: '14 days from today',
    uses: [
      {
        h2: 'Two weeks, to the same weekday',
        p: `Fourteen days is two whole weeks, so like seven it preserves the weekday exactly.
        This is why fortnightly and biweekly pay cycles are written in days: a payday that
        falls every fourteen days keeps landing on the same weekday all year, which is what
        makes it predictable to bank on. It also means a fourteen-day interval crosses exactly
        two weekends, no more and no fewer, whichever day you start from.`
      },
      {
        h2: 'Fourteen-day cooling-off and cancellation windows',
        p: `Fourteen days is the standard consumer withdrawal period in EU and UK distance-selling
        rules: a buyer who orders online generally has fourteen days from receiving the goods to
        change their mind. The same length turns up in trial subscriptions, in insurance
        cooling-off terms, and in two-week resignation notice. When the window starts on
        <em>receipt</em> rather than on the order, count from the delivery date, not from
        today.`
      }
    ],
    faq: [
      { q: 'Is 14 days the same as two weeks?',
        a: 'Yes — two weeks is fourteen days by definition, and both land on the same weekday as today.' },
      { q: 'When does a 14-day cooling-off period start?',
        a: 'Usually from the day the goods arrive or the contract is concluded, not from the day the order was placed. Enter that starting date in the date calculator rather than using today.' },
      { q: 'Why do employers count notice in 14 days rather than half a month?',
        a: 'Because a fixed fourteen days always keeps the same weekday and the same number of working days, while half a month varies between fourteen and sixteen days depending on the month.' }
    ]
  },
  {
    slug: '15-days-from-today', unit: 'day', amount: 15, dir: 'fwd',
    label: '15 days from today',
    uses: [
      {
        h2: 'Half a month, roughly but not exactly',
        p: `Fifteen days is the usual stand-in for half a month, and it is a stand-in rather than
        an equal: half of a 31-day month is fifteen and a half days, half of February is
        fourteen. That is why semi-monthly pay is normally defined by the calendar (the 15th and
        the last day) instead of by a fifteen-day count — a fixed fifteen-day step would drift
        away from the month within a year.`
      },
      {
        h2: 'Fifteen-day terms in invoicing and filing',
        p: `Net 15 is the short end of ordinary invoice terms, used where cash flow matters more
        than goodwill: freelance work, small trade suppliers, deposits before scheduling.
        Fifteen days also appears as a common grace period on insurance premiums and loan
        instalments before a late charge is applied. Because fifteen days is an odd number of
        days, it always moves the weekday by one — a Monday start ends on a Tuesday.`
      }
    ],
    faq: [
      { q: 'Is 15 days half a month?',
        a: 'Only approximately. Months run 28 to 31 days, so fifteen days is slightly under half of most months and slightly over half of February.' },
      { q: 'What does Net 15 mean on an invoice?',
        a: 'Payment is due fifteen days after the invoice date. This page counts fifteen calendar days from today, weekends included.' },
      { q: 'Does the weekday change over 15 days?',
        a: 'Yes, by one. Fifteen is two weeks plus a day, so the result always falls one weekday later than today.' }
    ]
  },
  {
    slug: '21-days-from-today', unit: 'day', amount: 21, dir: 'fwd',
    label: '21 days from today',
    uses: [
      {
        h2: 'Three weeks, weekday intact',
        p: `Twenty-one days is three exact weeks, so it is the longest of the common intervals
        that still returns the same weekday as today. Anything built around a weekly rhythm —
        a three-week course, a three-cycle schedule, a rotating shift pattern — can be counted
        in twenty-ones without the day drifting. It also crosses exactly three weekends,
        whatever day you start on.`
      },
      {
        h2: 'Where a 21-day window is written into a rule',
        p: `Twenty-one days is the review period an employer must give an individual employee to
        consider a severance agreement that waives age-discrimination claims under the US Older
        Workers Benefit Protection Act; a group layoff gets forty-five days instead. Twenty-one
        days is also a common length for a court response deadline and for the notice period on
        some meetings and hearings. The count is calendar days, so a twenty-one-day window
        never gains time because of a bank holiday.`
      }
    ],
    faq: [
      { q: 'Is 21 days exactly three weeks?',
        a: 'Yes. Three weeks is twenty-one days, and the result falls on the same weekday as today.' },
      { q: 'Why is 21 days a common legal review period?',
        a: 'It gives a full three weekends to seek advice while still being countable in whole weeks. US severance agreements waiving age claims use a 21-day individual review period and 45 days for group layoffs.' },
      { q: 'Is 21 days the same as three weeks of work?',
        a: 'No. Twenty-one calendar days contain fifteen weekdays, so it is three working weeks only if you ignore public holidays.' }
    ]
  },
  {
    slug: '30-days-from-today', unit: 'day', amount: 30, dir: 'fwd',
    label: '30 days from today',
    uses: [
      {
        h2: 'Thirty days is not "one month"',
        p: `This is the single most common mistake with the interval. Thirty days from 31 January
        is 2 March, not 28 February; thirty days from a date in a 31-day month always lands
        before the same date in the next month. Contracts that mean the calendar month say
        "one month", and contracts that mean a fixed count say "30 days" — the two produce
        different dates seven months of the year. If you need the calendar-month version, the
        <a href="/date-calculator/">date calculator</a> adds months with proper end-of-month
        clamping.`
      },
      {
        h2: 'Net 30, notice to vacate, and 30-day returns',
        p: `Thirty days is the default commercial credit term: Net 30 means the invoice falls due
        thirty days after its date, and accounts-receivable ageing reports bucket everything
        past that as 30, 60 and 90 days overdue. It is also the standard notice a
        month-to-month tenant or a subscriber gives to end an agreement, and the length of a
        typical retail returns window. In all three cases the count is calendar days from the
        trigger date — the invoice date, the day notice is served, the day of purchase — which
        is often not today.`
      }
    ],
    faq: [
      { q: 'Is 30 days from today the same as one month from today?',
        a: 'Only in a 30-day month. Adding 30 days to a date in a 31-day month lands one day before the same date next month, and in February it overshoots by two or three days.' },
      { q: 'What does Net 30 mean?',
        a: 'The invoice is payable thirty days after the invoice date. Count from the invoice date rather than from today if the invoice was issued earlier.' },
      { q: 'Does a 30-day notice period include weekends and holidays?',
        a: 'Yes, unless the agreement says business days. A plain 30-day notice runs on calendar days straight through weekends and public holidays.' }
    ]
  },
  {
    slug: '45-days-from-today', unit: 'day', amount: 45, dir: 'fwd',
    label: '45 days from today',
    uses: [
      {
        h2: 'The 45-day identification period',
        p: `Forty-five days is the deadline that gives this interval its name in US tax practice.
        In a like-kind (1031) exchange, the taxpayer has exactly forty-five days from
        transferring the relinquished property to identify replacement property in writing, and
        180 days to complete the purchase. Both clocks start on the same day and run
        concurrently, which is why the two intervals are always quoted together — see
        <a href="/180-days-from-today/">180 days from today</a> for the closing end of it. The
        forty-five days are calendar days and the statute does not extend them for weekends.`
      },
      {
        h2: 'Six and a half weeks of planning runway',
        p: `Away from tax deadlines, forty-five days is the length people reach for when thirty is
        too tight and sixty is too loose: Net 45 supplier terms, a forty-five-day review window
        on a group severance offer under US age-discrimination rules, mid-length project
        milestones, and the notice some commercial leases require. It is six weeks and three
        days, so the weekday always shifts by three.`
      }
    ],
    faq: [
      { q: 'What is the 45-day rule in a 1031 exchange?',
        a: 'Replacement property must be identified in writing within 45 calendar days of transferring the relinquished property, with the exchange completed within 180 days.' },
      { q: 'Do the 45 days pause for weekends or holidays?',
        a: 'No. The identification period runs on calendar days, so a deadline landing on a Sunday is still that Sunday.' },
      { q: 'How many weeks is 45 days?',
        a: 'Six weeks and three days. The weekday of the result is always three later than today.' }
    ]
  },
  {
    slug: '60-days-from-today', unit: 'day', amount: 60, dir: 'fwd',
    label: '60 days from today',
    uses: [
      {
        h2: 'Two of the best-known 60-day clocks',
        p: `If you take money out of an IRA or workplace retirement plan, US rules give you sixty
        days to put it into another eligible plan before it is treated as a taxable
        distribution — the 60-day rollover. Separately, someone who loses group health coverage
        has sixty days to elect COBRA continuation. Both are counted in calendar days from the
        triggering event, not from when the paperwork arrived, and both are famously
        unforgiving about the last day.`
      },
      {
        h2: 'Sixty days as a notice and credit term',
        p: `Sixty days is the longer of the two standard notice periods: senior roles, commercial
        leases and supplier contracts often ask for sixty rather than thirty. On the credit
        side, Net 60 is common where the buyer has leverage, and "60 days past due" is the
        second bucket on an ageing report — the point at which most collection processes
        escalate. Sixty days is a touch under two calendar months in every month pair except
        July–August, so a "60 days" clause and a "two months" clause rarely agree.`
      }
    ],
    faq: [
      { q: 'What is the 60-day rollover rule?',
        a: 'A retirement plan distribution paid to you must be redeposited into an eligible plan or IRA within 60 days, or it counts as a taxable distribution.' },
      { q: 'Is 60 days two months?',
        a: 'Almost never exactly. Two calendar months usually run 61 or 62 days, so a 60-day count lands a day or two earlier.' },
      { q: 'Does the 60-day COBRA election period include weekends?',
        a: 'Yes. It is 60 calendar days from the later of losing coverage or receiving the election notice.' }
    ]
  },
  {
    slug: '90-days-from-today', unit: 'day', amount: 90, dir: 'fwd',
    label: '90 days from today',
    uses: [
      {
        h2: 'Probation periods and 90-day reviews',
        p: `Ninety days is the default length of an introductory or probationary period in US
        employment, and of the first formal review that goes with it. Benefits eligibility is
        often written to the same clock — a plan may not impose a waiting period longer than 90
        days under the Affordable Care Act. When the offer letter says "90 days", it means
        ninety calendar days from the start date, so a spring start puts the review in
        mid-summer regardless of how the working weeks fall.`
      },
      {
        h2: 'The 90-in-180 travel rule, and why the pair matters',
        p: `Short-stay visa-free access to the Schengen area is capped at 90 days within any
        rolling 180-day period. The rolling part is what trips people: the window is not a
        calendar half-year, it is the 180 days ending on whichever day you are counting, so
        every day of travel ages out exactly 180 days later. To see the other end of that
        window, use <a href="/180-days-ago/">180 days ago</a>, which gives the earliest date
        that still counts against today's allowance.`
      },
      {
        h2: 'Ninety days is not a quarter',
        p: `Calendar quarters run 90, 91 or 92 days — Q1 is 90 days only in a non-leap year — so a
        90-day count and a "next quarter" deadline drift apart by up to two days. Warranties,
        return-of-goods windows and 90-day payment terms all use the fixed count, which is
        precisely why they are written as a number of days instead of as a quarter.`
      }
    ],
    faq: [
      { q: 'Is 90 days from today the same as three months?',
        a: 'No. Three calendar months run 89 to 92 days depending on which months they are, so the two counts usually land on different dates.' },
      { q: 'How does the Schengen 90/180 rule count days?',
        a: 'It allows 90 days of stay inside any rolling 180-day window, counting backwards from the day in question — not inside a fixed calendar period.' },
      { q: 'Does a 90-day probation period skip weekends?',
        a: 'No. Probation is counted in calendar days from the start date, so weekends and holidays are inside the ninety.' }
    ]
  },
  {
    slug: '100-days-from-today', unit: 'day', amount: 100, dir: 'fwd',
    label: '100 days from today',
    uses: [
      {
        h2: 'A round number with no calendar meaning',
        p: `One hundred days is the rare interval that exists purely because we count in tens. It
        matches nothing in the calendar: it is not a quarter, not three months, not fourteen
        weeks (that is 98 days) — it is fourteen weeks and two days, so it shifts the weekday by
        two. That independence is the point. A hundred-day marker cannot be confused with a
        reporting period or a billing cycle, which makes it useful precisely where you want a
        deadline that belongs to the project and not to the finance calendar.`
      },
      {
        h2: 'Where the hundred-day marker gets used',
        p: `The best-known use is political: the first hundred days of a new administration, a
        frame that dates back to the opening of Franklin D. Roosevelt's first term in 1933 and
        has been reapplied to new chief executives ever since. Schools mark the hundredth day of
        the year for early-years classes. Fundraisers, training blocks and product launches
        borrow it for the same reason — it is long enough to show real progress and short
        enough to hold attention.`
      }
    ],
    faq: [
      { q: 'How many weeks is 100 days?',
        a: 'Fourteen weeks and two days. A hundred days therefore lands two weekdays later than today.' },
      { q: 'Is 100 days about three months?',
        a: 'It is a little longer — three calendar months are 89 to 92 days, so a hundred days runs roughly a week past the three-month mark.' },
      { q: 'Where does the "first 100 days" idea come from?',
        a: 'From the opening period of Franklin D. Roosevelt\'s first presidential term in 1933, and it has been reused as a progress marker ever since.' }
    ]
  },
  {
    slug: '120-days-from-today', unit: 'day', amount: 120, dir: 'fwd',
    label: '120 days from today',
    uses: [
      {
        h2: 'Four months, counted in days',
        p: `A hundred and twenty days is four thirty-day months, which is why it appears wherever
        a contract wants a four-month feel with a fixed, arguable-proof number. Against the real
        calendar it is a few days short of four months: four consecutive calendar months run 120
        to 123 days, so a 120-day deadline generally lands just before the same date four months
        out, and further before it when February is inside the span.`
      },
      {
        h2: 'Validity periods and long lead times',
        p: `Documents that go stale tend to be given a 120-day life: appraisal and valuation
        reports, some credit approvals and rate locks, background and compliance checks, and
        quotations for long-lead equipment. The logic is that four months is long enough to
        finish a transaction but short enough that market conditions have not moved
        underneath the paperwork. Because the count runs from the report or approval date and
        not from today, put that date into the
        <a href="/date-calculator/">date calculator</a> when you are checking whether something
        has expired.`
      }
    ],
    faq: [
      { q: 'How many months is 120 days?',
        a: 'Just under four. Four calendar months are 120 to 123 days, so a 120-day count usually lands a day or three before the four-month anniversary.' },
      { q: 'How many weeks is 120 days?',
        a: 'Seventeen weeks and one day, so the result falls one weekday later than today.' },
      { q: 'Do 120-day validity periods count weekends?',
        a: 'Yes. Validity is measured in calendar days from the date on the document.' }
    ]
  },
  {
    slug: '150-days-from-today', unit: 'day', amount: 150, dir: 'fwd',
    label: '150 days from today',
    uses: [
      {
        h2: 'Five months in fixed days',
        p: `A hundred and fifty days is five thirty-day months and just over twenty-one weeks. It
        sits in the gap between the two intervals people default to — 120 and 180 — and is
        chosen when four months is too short to deliver and six months invites drift. Against
        the calendar it runs three to five days short of the five-month anniversary, depending
        on whether the span includes February.`
      },
      {
        h2: 'Long-range scheduling: growing, training and building',
        p: `Five-month counts are common where a physical process, not an office deadline, sets
        the pace: crop and planting schedules counted in days to harvest, curing and settling
        times in construction, long training blocks that ramp over twenty-one weeks, and lead
        times for made-to-order goods. In each case the count is unbroken calendar days —
        nothing pauses over a weekend — which is why the answer below is a plain calendar
        date rather than a working-day count.`
      }
    ],
    faq: [
      { q: 'How many weeks is 150 days?',
        a: 'Twenty-one weeks and three days, so the result lands three weekdays past today.' },
      { q: 'Is 150 days five months?',
        a: 'Close but short. Five consecutive calendar months run 151 to 155 days, so 150 days stops a few days before the anniversary.' },
      { q: 'How many working days are inside 150 calendar days?',
        a: 'About 107 weekdays, before subtracting public holidays. The result box above shows the exact weekday count for the span starting today.' }
    ]
  },
  {
    slug: '180-days-from-today', unit: 'day', amount: 180, dir: 'fwd',
    label: '180 days from today',
    uses: [
      {
        h2: 'The 180-day exchange deadline',
        p: `In a US like-kind (1031) exchange, the replacement property must be received within
        180 days of transferring the relinquished property — or by the due date of that year's
        tax return including extensions, whichever comes first. That second half is the part
        that catches people out: a late-year sale can have its 180 days cut short by the filing
        deadline. The matching 45-day identification clock starts on the same day and is
        covered on <a href="/45-days-from-today/">45 days from today</a>.`
      },
      {
        h2: 'Rolling windows and six-month validity',
        p: `A hundred and eighty days is the length of the rolling window in the Schengen 90/180
        short-stay rule, and the practical meaning of the "six months' passport validity" many
        countries ask for on entry. It is also the point at which medical, dental and optical
        recall intervals are commonly set. Note that 180 days is slightly short of half a year:
        a non-leap year is 365 days, so half of it is 182 and a half.`
      }
    ],
    faq: [
      { q: 'Is 180 days six months?',
        a: 'Not exactly. Six calendar months run 181 to 184 days, so a 180-day count lands one to four days before the six-month anniversary.' },
      { q: 'What is the 180-day rule in a 1031 exchange?',
        a: 'The replacement property must be received within 180 days of the transfer, or by the tax return due date including extensions for that year — whichever is earlier.' },
      { q: 'How does 180 days relate to the Schengen 90/180 rule?',
        a: 'The 180 days is the rolling look-back window inside which no more than 90 days of stay are allowed. The window moves with every day that passes.' }
    ]
  },
  {
    slug: '270-days-from-today', unit: 'day', amount: 270, dir: 'fwd',
    label: '270 days from today',
    uses: [
      {
        h2: 'Nine thirty-day months',
        p: `Two hundred and seventy days is nine months of thirty days each, and thirty-eight
        weeks and four days on the calendar. It is the interval used where a nine-month process
        needs a single fixed number: academic years counted from an autumn start, nine-month
        secondment and posting lengths, and long manufacturing or certification programmes. The
        real nine calendar months from today are a few days longer than 270 — between 273 and
        275, depending on which months the span covers.`
      },
      {
        h2: 'Not the same as a 40-week pregnancy count',
        p: `Human pregnancy is often described as nine months, but clinical dating uses 280 days —
        forty weeks from the first day of the last menstrual period, not 270. If that is what
        you are counting, the <a href="/due-date-calculator/">due date calculator</a> applies
        the 280-day convention and counts from the correct starting date rather than from
        today.`
      }
    ],
    faq: [
      { q: 'How many months is 270 days?',
        a: 'Nine thirty-day months, which is slightly short of nine calendar months — those run 273 to 275 days.' },
      { q: 'Is 270 days a full pregnancy?',
        a: 'No. Clinical dating uses 280 days, or 40 weeks from the last menstrual period, so 270 days falls about a week and a half short.' },
      { q: 'How many weeks is 270 days?',
        a: 'Thirty-eight weeks and four days, so the weekday moves four places forward from today.' }
    ]
  },
  {
    slug: '365-days-from-today', unit: 'day', amount: 365, dir: 'fwd',
    label: '365 days from today',
    uses: [
      {
        h2: 'When 365 days is not the same date next year',
        p: `Adding 365 days lands on the same date one year later only when the span contains no
        29 February. If a leap day falls inside it, 365 days lands one day <em>before</em> the
        anniversary. That is the whole reason anniversaries, birthdays and annual renewals are
        written as calendar dates rather than as a day count: the calendar handles the leap day,
        a fixed 365 does not.`
      },
      {
        h2: 'Rolling twelve-month windows',
        p: `Where a rule needs "the last year" to move with the current day rather than reset in
        January, it is written as a rolling 365-day window: leave entitlement measured
        backwards from each request, lookback periods for eligibility, twelve-month totals in
        reporting. Because 365 is not a multiple of seven, the weekday always shifts by one in
        an ordinary year, and by two across a leap day.`
      }
    ],
    faq: [
      { q: 'Is 365 days from today exactly one year?',
        a: 'Only if no 29 February falls in between. When a leap day is inside the span, 365 days lands one day before the same date next year.' },
      { q: 'What weekday is 365 days from today?',
        a: 'One weekday later than today in an ordinary year, and two later when a leap day is crossed, because 365 divided by seven leaves a remainder of one.' },
      { q: 'How many weekdays are in 365 days?',
        a: 'About 260 to 262 Mondays through Fridays, before public holidays. The result box shows the exact split for the span starting today.' }
    ]
  },

  // ---------------------------------------------------------------- weeks
  {
    slug: '2-weeks-from-today', unit: 'week', amount: 2, dir: 'fwd',
    label: '2 weeks from today',
    uses: [
      {
        h2: 'The default unit of short-term work',
        p: `Two weeks is the length most teams plan in. A fortnight is long enough to finish
        something and short enough that nobody forgets what they committed to, which is why the
        two-week sprint became the standard iteration in software delivery and why so many
        rotas, pay cycles and shift patterns run on the same beat. Because it is exactly
        fourteen days, the end of every cycle keeps landing on the same weekday.`
      },
      {
        h2: 'Two weeks' + "'" + ` notice`,
        p: `Giving two weeks before leaving a job is a US convention rather than a legal
        requirement in at-will states, and it is counted in calendar days from the day notice is
        given — so a Wednesday resignation makes the last day a Wednesday. Two weeks is also
        the standard advance for holiday requests and for cancelling appointments without a
        fee. If your notice starts on a date other than today, use the
        <a href="/date-calculator/">date calculator</a> and put that date in as the start.`
      }
    ],
    faq: [
      { q: 'How many days is 2 weeks?',
        a: 'Fourteen days exactly, so two weeks from today falls on the same weekday as today.' },
      { q: 'When does two weeks\' notice end?',
        a: 'Fourteen calendar days after the day notice is given, which lands on the same weekday. Weekends inside the period still count.' },
      { q: 'How many working days are in two weeks?',
        a: 'Ten weekdays, before any public holidays. The result box above shows the exact weekday and weekend split.' }
    ]
  },
  {
    slug: '4-weeks-from-today', unit: 'week', amount: 4, dir: 'fwd',
    label: '4 weeks from today',
    uses: [
      {
        h2: 'Four weeks is 28 days, not a month',
        p: `This is the distinction the interval exists to make. Four weeks is always exactly
        twenty-eight days and always returns the same weekday; a month is 28 to 31 days and
        returns the same date. They coincide only in a non-leap February. Anything paid or
        scheduled every four weeks therefore happens thirteen times a year, not twelve — which
        is why four-weekly pay and four-weekly billing produce an extra period roughly every
        year and confuse budgets built on monthly figures.`
      },
      {
        h2: 'Four-week cycles in health and training',
        p: `Repeat medication is commonly dispensed in twenty-eight-day packs so a cycle always
        starts on the same weekday, which makes adherence easier to track. Training blocks and
        rehabilitation programmes use the same four-week structure — three weeks of loading and
        one lighter week is a widespread pattern — for the same reason: the schedule never
        drifts across the week.`
      }
    ],
    faq: [
      { q: 'Is 4 weeks the same as one month?',
        a: 'No. Four weeks is always 28 days; a month is 28 to 31. They match only in February of a non-leap year.' },
      { q: 'How many four-week periods are in a year?',
        a: 'Thirteen, with one or two days left over — which is why four-weekly pay produces thirteen pay periods rather than twelve.' },
      { q: 'Does 4 weeks from today fall on the same weekday?',
        a: 'Yes. Twenty-eight days is a whole number of weeks, so the weekday never moves.' }
    ]
  },
  {
    slug: '6-weeks-from-today', unit: 'week', amount: 6, dir: 'fwd',
    label: '6 weeks from today',
    uses: [
      {
        h2: 'The standard recovery and review checkpoint',
        p: `Six weeks is the interval medicine reaches for when soft tissue and bone need time to
        knit: the routine postnatal check, the follow-up after many orthopaedic procedures, and
        the point at which a lot of "no heavy lifting" restrictions are reassessed. It is forty-
        two days, a whole number of weeks, so a Thursday appointment schedules a Thursday
        follow-up — which is why clinics like it.`
      },
      {
        h2: 'Six weeks in school terms and lead times',
        p: `A half-term block in the UK school year runs roughly six weeks, as does the long
        summer break in many systems. Print, manufacturing and visa-processing lead times are
        often quoted at six weeks for the same reason: it is a month and a half in a form that
        does not depend on which month you are in. Counting in weeks also keeps the deadline on
        a working weekday if today is one.`
      }
    ],
    faq: [
      { q: 'How many days is 6 weeks?',
        a: 'Forty-two days, landing on the same weekday as today.' },
      { q: 'Is 6 weeks the same as a month and a half?',
        a: 'Roughly. A month and a half is 43 to 47 days, so six weeks is a little shorter and always keeps the weekday.' },
      { q: 'Why are so many follow-up appointments at six weeks?',
        a: 'It is long enough for substantial tissue and bone healing to have happened, and it keeps the appointment on the same weekday as the original.' }
    ]
  },
  {
    slug: '8-weeks-from-today', unit: 'week', amount: 8, dir: 'fwd',
    label: '8 weeks from today',
    uses: [
      {
        h2: 'Fifty-six days, two four-week blocks',
        p: `Eight weeks is fifty-six days and stacks neatly: two four-week cycles, four fortnights,
        or four two-week sprints. That divisibility is why structured programmes so often come
        in eights — an eight-week course splits into halves and quarters without any week
        landing awkwardly, and every checkpoint keeps the same weekday.`
      },
      {
        h2: 'Where eight weeks is the quoted answer',
        p: `Eight weeks is a common quoted turnaround for made-to-order furniture, passport and
        licence processing at busy times, and clinical waiting-list targets. It is also the
        typical length of a beginner training plan or a taught short course — long enough for
        measurable adaptation, short enough to commit to. Because it is a whole number of
        weeks, an eight-week plan starting on a Monday always ends on a Monday.`
      }
    ],
    faq: [
      { q: 'How many days is 8 weeks?',
        a: 'Fifty-six days. The result falls on the same weekday as today.' },
      { q: 'Is 8 weeks two months?',
        a: 'Slightly less. Two calendar months are 59 to 62 days, so eight weeks lands a few days short.' },
      { q: 'How many working days are in 8 weeks?',
        a: 'Forty weekdays before public holidays — eight sets of five.' }
    ]
  },
  {
    slug: '12-weeks-from-today', unit: 'week', amount: 12, dir: 'fwd',
    label: '12 weeks from today',
    uses: [
      {
        h2: 'A quarter you can actually plan against',
        p: `Twelve weeks is eighty-four days: not a calendar quarter, but close enough that
        planning cycles have largely adopted it. The advantage over a real quarter is that
        every twelve-week block contains exactly the same amount of time — sixty weekdays,
        twelve weekends — so two blocks are genuinely comparable, while Q1 and Q3 differ by two
        days and by their holidays.`
      },
      {
        h2: 'Twelve-week programmes and the FMLA year',
        p: `Endurance training plans are built in twelve-week cycles because that is roughly how
        long a full base-build-peak progression takes. Twelve weeks is also the annual
        entitlement under the US Family and Medical Leave Act — up to twelve workweeks of
        job-protected unpaid leave in a twelve-month period for eligible employees — though
        that is counted in workweeks used, not as one continuous span from today.`
      }
    ],
    faq: [
      { q: 'How many days is 12 weeks?',
        a: 'Eighty-four days, landing on the same weekday as today.' },
      { q: 'Is 12 weeks the same as three months?',
        a: 'No. Three calendar months run 89 to 92 days, so twelve weeks is five to eight days shorter.' },
      { q: 'How many working days are in 12 weeks?',
        a: 'Sixty weekdays before public holidays, which is what makes twelve-week blocks directly comparable to each other.' }
    ]
  },

  // ---------------------------------------------------------------- business days
  {
    slug: '5-business-days-from-today', unit: 'business', amount: 5, dir: 'fwd',
    label: '5 business days from today',
    uses: [
      {
        h2: 'One working week, wherever you start',
        p: `Five business days is a full working week, and because it skips both weekend days it
        always returns the same weekday as today — five business days from a Wednesday is the
        next Wednesday. If today is a Saturday or Sunday, the count starts from the following
        Monday, so the answer is that week's Friday.`
      },
      {
        h2: 'The most common processing promise',
        p: `"Allow five business days" is the standard wording for a bank transfer to settle, a
        refund to appear, a document to be issued, or a support case to be resolved. Read it as
        a maximum rather than a schedule: it is chosen because five working days covers a full
        cycle of internal handoffs regardless of which day the request arrives. What the phrase
        does not cover is public holidays — those are working days as far as this calculation is
        concerned, so subtract one for each holiday inside the span.`
      }
    ],
    faq: [
      { q: 'How long is 5 business days?',
        a: 'One working week: seven calendar days when the span crosses one weekend, so the result is the same weekday as today.' },
      { q: 'Do public holidays count as business days here?',
        a: 'This page skips Saturdays and Sundays only. Holidays vary by country, state and employer, so subtract one day for each that falls inside the span.' },
      { q: 'What if today is a Saturday?',
        a: 'The count starts from the next weekday, so five business days from a weekend lands on the Friday of the following week.' }
    ]
  },
  {
    slug: '10-business-days-from-today', unit: 'business', amount: 10, dir: 'fwd',
    label: '10 business days from today',
    uses: [
      {
        h2: 'Two working weeks, fourteen calendar days',
        p: `Ten business days spans two weekends, so on the calendar it is fourteen days from a
        weekday start — and lands on the same weekday. The gap between the two numbers is why
        the wording matters so much in a contract: ten business days gives the other side four
        more calendar days than a plain ten-day clause, which is the difference between a
        deadline that is comfortable and one that is not.`
      },
      {
        h2: 'Where ten working days is the written standard',
        p: `Ten business days is the classic clearing and dispute window: cheque holds on larger
        deposits, chargeback and card-dispute acknowledgements, records requests, and the
        turnaround many public bodies commit to for a first substantive response. It is long
        enough to route work through two weekly cycles, which is precisely the point — anything
        that needs a second pass by the same person fits inside it.`
      }
    ],
    faq: [
      { q: 'How many calendar days is 10 business days?',
        a: 'Fourteen, when the count starts on a weekday — two working weeks with two weekends inside them.' },
      { q: 'Is 10 business days the same as two weeks?',
        a: 'On the calendar, yes, from a weekday start. The wording differs because a holiday inside the span pushes the business-day version later.' },
      { q: 'Are bank holidays excluded from 10 business days?',
        a: 'In practice yes, but holidays differ by country and region, so this page counts weekdays only and leaves the holiday adjustment to you.' }
    ]
  },
  {
    slug: '15-business-days-from-today', unit: 'business', amount: 15, dir: 'fwd',
    label: '15 business days from today',
    uses: [
      {
        h2: 'Three working weeks',
        p: `Fifteen business days is three full working weeks and twenty-one calendar days from a
        weekday start — a whole number of weeks again, so the weekday is unchanged. That extra
        week over the usual ten is what separates a routine request from one that needs a
        decision from somebody who is not in the room.`
      },
      {
        h2: 'Escalation and appeal windows',
        p: `Fifteen working days is a common statutory or policy deadline for a substantive
        response: internal complaint and grievance procedures, appeal acknowledgements,
        insurer decisions on a submitted claim, and second-stage information requests. Because
        the count excludes weekends, a fifteen-working-day deadline announced before a holiday
        period is materially later than the calendar suggests — worth checking before you
        assume a deadline has been missed.`
      }
    ],
    faq: [
      { q: 'How many calendar days is 15 business days?',
        a: 'Twenty-one from a weekday start — three working weeks with three weekends inside them.' },
      { q: 'Does the result fall on the same weekday as today?',
        a: 'Yes, when today is a weekday, because fifteen business days is a whole number of working weeks.' },
      { q: 'Should I subtract public holidays?',
        a: 'Yes — this page skips weekends only. Each public holiday inside the span pushes the true deadline one day later.' }
    ]
  },
  {
    slug: '20-business-days-from-today', unit: 'business', amount: 20, dir: 'fwd',
    label: '20 business days from today',
    uses: [
      {
        h2: 'A working month',
        p: `Twenty business days is the standard shorthand for a month of work: four working weeks
        and twenty-eight calendar days from a weekday start. It is also the reason payroll and
        capacity planning so often assume twenty-one or twenty-two working days a month —
        twenty is the clean four-week figure, and the real monthly count varies between about
        nineteen and twenty-three once weekends and holidays fall where they fall.`
      },
      {
        h2: 'Long-form response deadlines',
        p: `Twenty working days is the response deadline written into several public-records
        regimes and into many procurement and tender timetables. It is chosen where the work
        genuinely takes a month of effort but the parties want a count that does not punish
        whoever happens to receive the request just before a long weekend. The same interval
        turns up as the maximum for internal investigations and for formal notice under some
        collective agreements.`
      }
    ],
    faq: [
      { q: 'How many calendar days is 20 business days?',
        a: 'Twenty-eight from a weekday start, which is four working weeks and four weekends.' },
      { q: 'Is 20 business days one month?',
        a: 'It is the usual working-month convention, but a real calendar month contains roughly 19 to 23 weekdays depending on how it falls.' },
      { q: 'Does this page skip public holidays?',
        a: 'No — weekends only. Deduct one working day for each holiday your organisation observes inside the span.' }
    ]
  },
  {
    slug: '30-business-days-from-today', unit: 'business', amount: 30, dir: 'fwd',
    label: '30 business days from today',
    uses: [
      {
        h2: 'Six working weeks — nowhere near 30 days',
        p: `This is the interval where the calendar-versus-working distinction becomes expensive.
        Thirty business days is forty-two calendar days from a weekday start: six full weeks,
        not one month. A clause that says "30 business days" gives twelve more calendar days
        than one that says "30 days", so reading past the word <em>business</em> can put a
        genuine deadline nearly two weeks out of place in either direction.`
      },
      {
        h2: 'Where a six-working-week clock is used',
        p: `Thirty working days appears in longer regulatory review periods, in extended
        complaint-handling stages after an initial deadline has been used up, in some visa and
        permit processing estimates, and in construction and supply contracts for defect
        rectification. It is deliberately long: the point is to allow for a full cycle of
        review, response and re-review without either side needing an extension.`
      }
    ],
    faq: [
      { q: 'How many calendar days is 30 business days?',
        a: 'Forty-two from a weekday start — six working weeks with six weekends inside them.' },
      { q: 'Is 30 business days the same as 30 days?',
        a: 'No, and the gap is large: 30 business days runs about twelve calendar days longer than a plain 30-day count.' },
      { q: 'Are holidays inside the 30 business days?',
        a: 'This page counts Monday to Friday only. Public holidays are not removed, so subtract one working day for each one you observe.' }
    ]
  },

  // ---------------------------------------------------------------- backwards
  {
    slug: '30-days-ago', unit: 'day', amount: 30, dir: 'back',
    label: '30 days ago',
    uses: [
      {
        h2: 'The start of a rolling month',
        p: `Counting back thirty days gives the opening edge of a rolling month — the window used
        by "last 30 days" reports in analytics, card statements described as a thirty-day
        billing period, and eligibility rules phrased as "in the previous 30 days". Rolling is
        the operative word: unlike a calendar month, this edge moves forward every night, so a
        transaction that was inside the window yesterday can be outside it today.`
      },
      {
        h2: 'Thirty days back in ageing and returns',
        p: `Accounts-receivable ageing puts everything invoiced before this date into the 30-day
        bucket or older, which is usually where chasing begins. Retail return windows work the
        same way from the buyer's side: if a purchase pre-dates the date shown above, a
        thirty-day returns policy has already closed on it. Both are counted in calendar days,
        weekends included.`
      }
    ],
    faq: [
      { q: 'What date was 30 days ago?',
        a: 'The box above shows it, computed from your device\'s clock when the page loaded, so it is correct on the day you read it.' },
      { q: 'Is 30 days ago the same as last month?',
        a: 'No. Last month means the same date in the previous calendar month, which is 28 to 31 days back. A fixed 30-day count rarely matches it.' },
      { q: 'Do "last 30 days" reports include today?',
        a: 'Usually they cover the 30 days up to and including today, so the earliest day included is the date shown above.' }
    ]
  },
  {
    slug: '60-days-ago', unit: 'day', amount: 60, dir: 'back',
    label: '60 days ago',
    uses: [
      {
        h2: 'The second ageing bucket',
        p: `Sixty days back is the boundary between "late" and "seriously late" in almost every
        collections process. An invoice dated before the date above sits in the 60-day column of
        an ageing report, which is typically where automated reminders stop and a person picks
        up the phone. On the consumer side, sixty days is the window many card issuers give for
        raising a billing error after the statement was sent.`
      },
      {
        h2: 'Two-month lookbacks',
        p: `Sixty-day lookbacks are used where one month is too short to show a pattern and ninety
        is too slow to react to: bank statements requested for an application, activity checks
        on dormant accounts, and eligibility rules that ask whether something happened in the
        past two months. Because the count is in fixed days rather than calendar months, the
        same query run on two consecutive days covers two different starting dates.`
      }
    ],
    faq: [
      { q: 'Is 60 days ago two months ago?',
        a: 'Not quite. Two calendar months back is usually 61 or 62 days, so a 60-day count lands slightly later than the two-month anniversary.' },
      { q: 'Why do lenders ask for 60 days of statements?',
        a: 'Two months is long enough to show recurring income and commitments while still being current. The window is counted back from the application date.' },
      { q: 'Does the 60-day count skip weekends?',
        a: 'No. It runs over every calendar day, including weekends and public holidays.' }
    ]
  },
  {
    slug: '90-days-ago', unit: 'day', amount: 90, dir: 'back',
    label: '90 days ago',
    uses: [
      {
        h2: 'A quarter of history, roughly',
        p: `Ninety days back is the default "last quarter" view in most reporting tools, and it is
        an approximation: real calendar quarters are 90, 91 or 92 days, so a rolling 90-day
        window never quite aligns with Q1, Q2, Q3 or Q4. That is usually a feature — the rolling
        version compares like with like across any starting point, while calendar quarters
        differ in length and in how many holidays they contain.`
      },
      {
        h2: 'Ninety-day lookbacks that matter',
        p: `Ninety days is the point at which an unpaid account is generally classed as seriously
        delinquent, and the horizon used for a great many eligibility questions: recent travel
        declarations, recent-activity checks, and the "have you, in the last 90 days" style of
        screening question. If you are counting Schengen days, remember that the allowance is 90
        days inside a rolling 180-day window — the earlier edge is on
        <a href="/180-days-ago/">180 days ago</a>, not this page.`
      }
    ],
    faq: [
      { q: 'Is 90 days ago the same as three months ago?',
        a: 'Usually not exactly. Three calendar months back is 89 to 92 days, so the two dates differ by a day or two most of the year.' },
      { q: 'What does a rolling 90-day window mean?',
        a: 'A window that always ends today and starts 90 days earlier, so it moves forward every day rather than resetting on a fixed date.' },
      { q: 'Does 90 days ago include today?',
        a: 'The date shown is 90 full days before today. A "last 90 days" range that includes today therefore starts on that date.' }
    ]
  },
  {
    slug: '180-days-ago', unit: 'day', amount: 180, dir: 'back',
    label: '180 days ago',
    uses: [
      {
        h2: 'The far edge of a rolling half-year',
        p: `A hundred and eighty days back is the earliest day that still counts inside a rolling
        180-day window — most notably the Schengen short-stay rule, where no more than 90 days
        of stay are permitted in any such window. Every day you spent abroad drops out of the
        count exactly 180 days later, which is why the date above is the one to check your
        travel history against rather than 1 January.`
      },
      {
        h2: 'Six-month lookbacks in records and eligibility',
        p: `Half-year lookbacks are used where recency matters but a single quarter is too noisy:
        six months of address history, six months of payment behaviour on a credit file summary,
        and the "within the last six months" wording on medical and screening forms. Note the
        slight mismatch — 180 days is a day or two short of six calendar months, so a form asking
        for six months wants a fraction more history than the date above.`
      }
    ],
    faq: [
      { q: 'Is 180 days ago six months ago?',
        a: 'Close, but one to four days later. Six calendar months back is 181 to 184 days depending on the months in the span.' },
      { q: 'How does this help with the Schengen 90/180 rule?',
        a: 'The date above is the start of the current rolling window. Only stays on or after that date count against the 90-day allowance.' },
      { q: 'Does the count include today?',
        a: 'The date shown is 180 full days before today, so a window described as "the last 180 days" runs from that date up to today.' }
    ]
  }
];

// The hub's grouped presentation. Order here is the order on the hub page and in
// the sitemap, so a new page appears in both from one edit.
export const DFT_GROUPS = [
  { title: 'Days from today', match: (p) => p.unit === 'day' && p.dir === 'fwd' },
  { title: 'Weeks from today', match: (p) => p.unit === 'week' },
  { title: 'Business days from today', match: (p) => p.unit === 'business' },
  { title: 'Counting backwards', match: (p) => p.dir === 'back' }
];
