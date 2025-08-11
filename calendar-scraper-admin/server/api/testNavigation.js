// server/api/test-navigation.js
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

    const config = {
      maxUnionsToProcess: 1,
      maxAgeGroupsToProcess: 2,
      maxPoolsToProcess: 3,
      timeout: 30000
    }

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

    const stats = {
      unions: 0,
      ageGroups: 0,
      pools: 0,
      matches: 0
    }

    // Test Level 1: Unions
    const success = await navigateTo(baseUrl)
    if (success) {
      stats.unions = await page.evaluate(() => document.querySelectorAll('.union-list a').length)
    }

    // Test Level 2: Age Groups (limited)
    if (stats.unions > 0) {
      const unionUrl = await page.evaluate(() => document.querySelector('.union-list a')?.href)
      if (unionUrl && await navigateTo(unionUrl)) {
        stats.ageGroups = await page.evaluate(() => document.querySelectorAll('.age-group-list a').length)
      }
    }

    // Test Level 3: Pools (limited)
    if (stats.ageGroups > 0) {
      const ageGroupUrl = await page.evaluate(() => document.querySelector('.age-group-list a')?.href)
      if (ageGroupUrl && await navigateTo(ageGroupUrl)) {
        stats.pools = await page.evaluate(() => document.querySelectorAll('.pool-list a').length)
      }
    }

    // Test Level 4: Matches (limited)
    if (stats.pools > 0) {
      const poolUrl = await page.evaluate(() => document.querySelector('.pool-list a')?.href)
      if (poolUrl && await navigateTo(poolUrl)) {
        await page.waitForSelector('.match-table', { timeout: config.timeout })
        stats.matches = await page.evaluate(() => document.querySelectorAll('.match-table tr').length)
      }
    }

    return { success: true, stats }
  } catch (error) {
    return { success: false, error: error.message }
  } finally {
    if (browser) await browser.close()
  }
})