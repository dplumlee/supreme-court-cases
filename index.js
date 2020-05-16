const fs = require('fs')
const process = require('process')
const glob = require('glob')

const args = process.argv.slice(2)
const startYear = args[0]
const endYear = args[1]

const justices = JSON.parse(fs.readFileSync('justices.json'))

// command line args error handling
if (startYear === undefined) {
  console.log('ERROR: A start year is needed')
  process.exit(1)
} else if (isNaN(parseInt(startYear))) {
  console.log('ERROR: Args need to be valid years')
  process.exit(1)

  // if there's a second date arg
} else if (endYear !== undefined) {
  if (isNaN(parseInt(endYear))) {
    console.log('ERROR: Args need to be valid years')
    process.exit(1)
  } else if (endYear < startYear) {
    console.log('ERROR: End year is less than start year')
    process.exit(1)
  }
}

const buildYearQuery = () => {
  // definitely not the best way to do this but glob doesnt support pure regex
  if (endYear === undefined) {
    return `${startYear}`
  }
  // creates a filled array for the year range
  const yearRange = Array.from(
    { length: endYear - startYear + 1 },
    (_, i) => i + parseInt(startYear)
  )
  return yearRange.join('|')
}

const aggregatedData = {}

const initialJusticeDataState = () => {
  return {
    timesInterruptedOthers: 0,
    timesInterrupted: 0,
    termsServedInSelection: {},
    timesSpoken: 0,
  }
}

glob(`./cases/+(${buildYearQuery()})/*.json`, (error, files) => {
  if (error) {
    console.log(error)
  } else if (files.length === 0) {
    console.log('\n** No cases matched your year range **')
  }

  for (const file of files) {
    const cases = JSON.parse(fs.readFileSync(file))
    console.log(cases.term + ' ' + cases.caseName)

    let interruptedFlag = false
    for (const { transcript } of cases.caseTranscripts) {
      for (const { speakerName, textObjs } of transcript) {
        if (justices[speakerName] !== undefined && aggregatedData[speakerName] === undefined) {
          aggregatedData[speakerName] = initialJusticeDataState()
        }
        justices[speakerName] !== undefined && aggregatedData[speakerName].timesSpoken++

        if (interruptedFlag === true) {
          interruptedFlag = false

          /** TODO: this will limit all data in between justices */
          if (justices[speakerName] !== undefined) {
            aggregatedData[speakerName].timesInterruptedOthers++
          }
        }
        for (const { text } of textObjs) {
          if (text.endsWith('--')) {
            if (justices[speakerName] !== undefined) {
              /** TODO: this will limit all data in between justices */
              interruptedFlag = true

              aggregatedData[speakerName].timesInterrupted++
            }
          }
        }
      }
    }
  }

  const calculateYearsServed = (judgeStartYear, judgeEndYear) => {
    if (!judgeEndYear) {
      return endYear - judgeStartYear + 1
    }
    const startPoint = Math.max(parseInt(startYear), parseInt(judgeStartYear))
    const finishPoint = Math.min(parseInt(endYear), parseInt(judgeEndYear))
    let yearsServed = 0
    for (let i = startPoint; i <= finishPoint; i++) {
      if (isOverlapped() === true) {
        yearsServed++
      }
    }
    return yearsServed

    function isOverlapped() {
      return (
        (startYear <= judgeEndYear && endYear >= judgeStartYear) ||
        (judgeStartYear <= endYear && judgeEndYear >= startYear)
      )
    }
  }

  // Adding rates per year
  for (const name in aggregatedData) {
    // TODO: Hacky workaround, fix this later
    if (
      aggregatedData[name].timesInterrupted === 0 &&
      aggregatedData[name].timesInterruptedOthers === 0
    ) {
      delete aggregatedData[name]
      continue
    }

    const judgeStartYear = justices[name].start_date.year
    const judgeEndYear = justices[name].end_date.year
    const yearsServed =
      endYear === undefined ? 1 : calculateYearsServed(judgeStartYear, judgeEndYear)

    const { timesInterrupted, timesInterruptedOthers, timesSpoken } = aggregatedData[name]

    aggregatedData[name].termsServedInSelection = yearsServed
    aggregatedData[name].timesPerYear = timesInterrupted / yearsServed
    aggregatedData[name].timesPerYearInterrupting = timesInterruptedOthers / yearsServed
    aggregatedData[name].timesSpokenPerYear = timesSpoken / yearsServed

    aggregatedData[name].normalizedPerYear =
      aggregatedData[name].timesPerYear / aggregatedData[name].timesSpokenPerYear
  }

  // Converting to sortable array
  const sortable = []
  for (const speaker in aggregatedData) {
    sortable.push([speaker, aggregatedData[speaker]])
  }

  sortable.sort((a, b) => b[1].normalizedPerYear - a[1].normalizedPerYear)

  // Print out results
  console.log(
    '\n\nInterruptions of Supreme Court Justices\n---------------------------------------'
  )
  for (const [name, data] of sortable) {
    console.log(
      `\n${name} - ${justices[name].person.gender} (${justices[name].role.start_affiliation})  ${data.termsServedInSelection} term(s) in selected range`
    )
    console.log(
      ' - Rate of being interrupted: ' +
        data.normalizedPerYear.toFixed(4) +
        ' | Times Interrupted: ' +
        data.timesInterrupted +
        ' | Times Per Year: ' +
        data.timesPerYear.toFixed(2) +
        ' | Times Interrupted Others: ' +
        data.timesInterruptedOthers +
        ' | Times Per Year: ' +
        data.timesPerYearInterrupting.toFixed(2) +
        ' | Times Speaking: ' +
        data.timesSpoken +
        ' | Times Per Year: ' +
        data.timesSpokenPerYear.toFixed(2)
    )
  }
})
