// server/api/scrape.js
import puppeteer from 'puppeteer'

export default defineEventHandler(async (event) => {
  const { baseUrl, venues } = await readBody(event)

  if (!baseUrl || !venues || !Array.isArray(venues)) {
    throw new Error('Invalid input: baseUrl and venues are required')
  }

  let browser
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
    await page.setViewport({ width: 1280, height: 800 })

    await page.setRequestInterception(true)
    page.on('request', (request) => {
      if (['image', 'stylesheet', 'font', 'script'].includes(request.resourceType())) {
        request.abort()
      } else {
        request.continue()
      }
    })

    const config = {
      maxRetries: 3,
      delayBetweenRequests: 2000,
      maxUnionsToProcess: 50,
      maxAgeGroupsToProcess: 50,
      maxPoolsToProcess: 200,
      timeout: 30000
    }

    const scrapingData = {
      unions: new Map(),
      ageGroups: new Map(),
      pools: new Map(),
      matches: []
    }

    // Helper: Navigate to URL
    const navigateTo = async (url) => {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeout })
        await page.waitForSelector('body', { timeout: config.timeout })
        return true
      } catch (error) {
        console.error(`Navigation error for ${url}:`, error)
        return false
      }
    }

    // Helper: Delay
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    // Level 1: Discover Unions
    const scrapeUnions = async () => {
      const success = await navigateTo(baseUrl)
      if (!success) throw new Error('Failed to load base URL')

      const unions = await page.evaluate(() => {
        const unionElements = Array.from(document.querySelectorAll('.union-list a'))
        return unionElements.map(el => ({
          name: el.textContent.trim(),
          url: el.href,
          level: 'union'
        }))
      })

      for (const union of unions) {
        scrapingData.unions.set(union.name, union)
      }
      return Array.from(scrapingData.unions.values())
    }

    // Level 2: Discover Age Groups
    const scrapeAgeGroups = async (unions) => {
      const processedUnions = unions.slice(0, config.maxUnionsToProcess)
      for (let i = 0; i < processedUnions.length; i++) {
        const union = processedUnions[i]
        await delay(config.delayBetweenRequests)
        const success = await navigateTo(union.url)
        if (!success) continue

        const ageGroups = await page.evaluate(() => {
          const ageGroupElements = Array.from(document.querySelectorAll('.age-group-list a'))
          return ageGroupElements.map(el => ({
            name: el.textContent.trim(),
            url: el.href,
            level: 'ageGroup'
          }))
        })

        for (const ageGroup of ageGroups) {
          scrapingData.ageGroups.set(`${union.name}_${ageGroup.name}`, {
            ...ageGroup,
            parentUnion: union.name
          })
        }
      }
      return Array.from(scrapingData.ageGroups.values())
    }

    // Level 3: Discover Pools
    const scrapePools = async (ageGroups) => {
      const processedAgeGroups = ageGroups.slice(0, config.maxAgeGroupsToProcess)
      for (let i = 0; i < processedAgeGroups.length; i++) {
        const ageGroup = processedAgeGroups[i]
        await delay(config.delayBetweenRequests)
        const success = await navigateTo(ageGroup.url)
        if (!success) continue

        const pools = await page.evaluate(() => {
          const poolElements = Array.from(document.querySelectorAll('.pool-list a'))
          return poolElements.map(el => ({
            name: el.textContent.trim(),
            url: el.href,
            level: 'pool'
          }))
        })

        for (const pool of pools) {
          scrapingData.pools.set(`${ageGroup.name}_${pool.name}`, {
            ...pool,
            parentAgeGroup: ageGroup.name
          })
        }
      }
      return Array.from(scrapingData.pools.values())
    }

    // Level 4-5: Discover and Filter Matches
    const scrapeMatches = async (pools) => {
      const processedPools = pools.slice(0, config.maxPoolsToProcess)
      let allMatches = []

      for (let i = 0; i < processedPools.length; i++) {
        const pool = processedPools[i]
        await delay(config.delayBetweenRequests)
        const success = await navigateTo(pool.url)
        if (!success) continue

        await page.waitForSelector('.match-table', { timeout: config.timeout })

        const matches = await page.evaluate(() => {
          const matchRows = Array.from(document.querySelectorAll('.match-table tr'))
          return matchRows.map(row => {
            const columns = Array.from(row.querySelectorAll('td'))
            if (columns.length >= 5) {
              return {
                date: columns[0].textContent.trim(),
                time: columns[1].textContent.trim(),
                homeTeam: columns[2].textContent.trim(),
                awayTeam: columns[3].textContent.trim(),
                venue: columns[4].textContent.trim(),
                status: 'scheduled',
                pool: pool.name,
                ageGroup: pool.parentAgeGroup
              }
            }
            return null
          }).filter(match => match !== null)
        })

        allMatches.push(...matches)
      }

      const filteredMatches = allMatches.filter(match =>
        venues.some(venue => match.venue.toLowerCase().includes(venue.toLowerCase()))
      )
      scrapingData.matches = filteredMatches
      return filteredMatches
    }

    // Run scraping
    const unions = await scrapeUnions()
    const ageGroups = await scrapeAgeGroups(unions)
    const pools = await scrapePools(ageGroups)
    const matches = await scrapeMatches(pools)

    return {
      success: true,
      data: {
        unions: Array.from(scrapingData.unions.values()),
        ageGroups: Array.from(scrapingData.ageGroups.values()),
        pools: Array.from(scrapingData.pools.values()),
        matches
      },
      stats: {
        unions: scrapingData.unions.size,
        ageGroups: scrapingData.ageGroups.size,
        pools: scrapingData.pools.size,
        matches: matches.length,
        venues
      }
    }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    if (browser) await browser.close()
  }
})