<template>
  <div class="space-y-6">
    <!-- Configuration Form -->
    <div class="grid grid-cols-1 gap-6">
      <!-- Season Selection -->
      <div class="flex items-center relative">
        <label class="text-sm font-medium text-gray-700 w-32 flex-shrink-0">
          Season:
        </label>
        <select
          v-model="settings.season"
          class="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 z-10"
        >
          <option value="2024/2025">2024/2025</option>
          <option value="2023/2024">2023/2024</option>
          <option value="2025/2026">2025/2026</option>
        </select>
      </div>

      <!-- Link Structure with Level Indicator -->
      <div class="flex items-start">
        <label class="text-sm font-medium text-gray-700 w-32 flex-shrink-0 mt-2">
          Link Structure:
        </label>
        <div class="flex-1">
          <textarea 
            v-model="settings.linkStructure"
            readonly
            class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 text-sm font-mono"
            rows="2"
          />
          <!-- Link Level Progress -->
          <div class="mt-2 flex items-center space-x-2">
            <span class="text-xs text-gray-500">Navigation Levels:</span>
            <div class="flex space-x-1">
              <div
                v-for="level in 5"
                :key="level"
                :class="[
                  'w-3 h-3 rounded-full text-xs flex items-center justify-center',
                  currentLevel >= level
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-500'
                ]"
                :title="`Level ${level}: ${getLevelName(level)}`"
              >
                {{ level }}
              </div>
            </div>
            <span class="text-xs text-gray-600">{{ getCurrentLevelDescription() }}</span>
          </div>
        </div>
      </div>
      
      <!-- Enhanced Venue Input with Multi-venue Support -->
      <div class="flex items-start">
        <label class="text-sm font-medium text-gray-700 w-32 flex-shrink-0 mt-2">
          Venues:
        </label>
        <div class="flex-1">
          <textarea
            v-model="settings.venues"
            type="text"
            placeholder="Enter venue names (separated by semicolons or new lines)"
            class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            rows="3"
            @input="parseVenues"
          />
          <div class="mt-1 text-xs text-gray-500">
            💡 <strong>Format examples:</strong> 
            <span class="font-mono">Grøndal MultiCenter; Arena Nord</span> or 
            <span class="font-mono">Grøndal MultiCenter, lokale 28</span>
          </div>
          
          <!-- Parsed Venues Display -->
          <div v-if="parsedVenues.length > 0" class="mt-2">
            <div class="text-xs text-gray-600 mb-1">Active venues ({{ parsedVenues.length }}):</div>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="(venue, index) in parsedVenues"
                :key="index"
                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800"
              >
                {{ venue }}
                <button
                  @click="removeVenue(index)"
                  class="ml-1 hover:text-blue-600"
                  title="Remove venue"
                >
                  ×
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Venue Presets -->
      <div class="flex items-center">
        <label class="text-sm font-medium text-gray-700 w-32 flex-shrink-0">
          Quick Select:
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="preset in venuePresets"
            :key="preset.name"
            @click="applyVenuePreset(preset)"
            class="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-md border transition-colors"
          >
            {{ preset.name }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- Action Buttons -->
    <div class="flex flex-wrap gap-3 justify-between">
      <!-- Autorun Toggle -->
      <button
        @click="toggleAutorun"
        :class="[
          'px-4 py-2 rounded-lg font-medium border-2 transition-all',
          settings.autorun
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-blue-600 border-blue-600 hover:bg-blue-50'
        ]"
      >
        Autorun: {{ settings.autorun ? 'On' : 'Off' }}
      </button>
      
      <!-- Link Level Navigation Test -->
      <button
        @click="testLinkLevels"
        :disabled="scraperStatus.isRunning || parsedVenues.length === 0"
        class="px-4 py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Test Link Navigation
      </button>
      
      <!-- Run Scraper -->
      <button
        @click="runScraper"
        :disabled="scraperStatus.isRunning || parsedVenues.length === 0"
        class="px-6 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Run Full Scraper
      </button>
      
      <!-- Clear All Matches -->
      <button
        @click="showClearMatchesConfirm = true"
        class="px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors"
      >
        Clear All Matches
      </button>
      
      <!-- Clear All Logs -->
      <button
        @click="showClearLogsConfirm = true"
        class="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
      >
        Clear All Logs
      </button>
    </div>
    
    <!-- Enhanced Status Display -->
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div class="text-sm text-gray-700 space-y-2">
        <div v-if="scraperStatus.isScheduled" class="text-blue-800">
          <span class="inline-block w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
          Scraper scheduled to run at midnight (in {{ timeUntilMidnight }} minutes)
        </div>
        <div v-if="scraperStatus.isRunning" class="text-green-800">
          <span class="inline-block w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
          {{ scraperStatus.currentActivity || 'Scraper is currently running...' }}
        </div>
        <div v-if="scraperStatus.lastRun" class="text-gray-600">
          Last run: {{ formatDateTime(scraperStatus.lastRun) }}
        </div>
        <div v-if="parsedVenues.length > 0" class="text-gray-600">
          <span class="font-medium">Active venues:</span> {{ parsedVenues.join(', ') }}
        </div>
        <div v-if="linkLevelStats" class="text-gray-600">
          <span class="font-medium">Last scan:</span> 
          {{ linkLevelStats.unions }} unions, 
          {{ linkLevelStats.ageGroups }} age groups, 
          {{ linkLevelStats.pools }} pools, 
          {{ linkLevelStats.matches }} matches found
        </div>
      </div>
    </div>

    <!-- Link Level Progress Display -->
    <div v-if="scraperStatus.isRunning && linkLevelProgress" class="bg-green-50 border border-green-200 rounded-lg p-4">
      <h4 class="text-sm font-medium text-green-800 mb-2">Navigation Progress</h4>
      <div class="space-y-2">
        <div class="flex justify-between text-xs">
          <span>Current Level: {{ linkLevelProgress.currentLevel }}</span>
          <span>{{ linkLevelProgress.processed }}/{{ linkLevelProgress.total }}</span>
        </div>
        <div class="w-full bg-green-200 rounded-full h-2">
          <div 
            class="bg-green-600 h-2 rounded-full transition-all duration-300"
            :style="{ width: `${(linkLevelProgress.processed / linkLevelProgress.total) * 100}%` }"
          ></div>
        </div>
        <div class="text-xs text-green-700">
          {{ linkLevelProgress.currentItem }}
        </div>
      </div>
    </div>
    
    <!-- Matches Display -->
    <div>
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-lg font-medium text-gray-900">Scraped Matches</h3>
        <div v-if="matches.length > 0" class="text-sm text-gray-500">
          {{ matches.length }} matches found
        </div>
      </div>
      <div v-if="matches.length === 0" class="text-gray-500 py-8 text-center">
        No matches to display yet.
      </div>
      <div v-else class="space-y-2">
        <MatchCard
          v-for="match in matches"
          :key="match.id"
          :match="match"
        />
      </div>
    </div>
    
    <!-- Confirmation Modals -->
    <ConfirmDialog
      v-model="showClearMatchesConfirm"
      title="Clear All Matches"
      message="Are you sure you want to clear all matches? This action cannot be undone."
      confirm-text="Clear Matches"
      @confirm="clearAllMatches"
    />
    
    <ConfirmDialog
      v-model="showClearLogsConfirm"
      title="Clear All Logs"
      message="Are you sure you want to clear all logs? This action cannot be undone."
      confirm-text="Clear Logs"
      @confirm="clearAllLogs"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import ConfirmDialog from './confirmDialog.vue'
import MatchCard from './MatchCard.vue'

import { useScraper } from '@/composables/useScraper'
import { useMatches } from '@/composables/useMatches'
import { useLogs } from '@/composables/useLogs'
import { useNotifications } from '@/composables/useNotifications'

const { settings, scraperStatus, updateSettings, startScraping } = useScraper()
const { matches, clearMatches } = useMatches()
const { clearLogs } = useLogs()
const { addNotification } = useNotifications()

// Component state
const showClearMatchesConfirm = ref(false)
const showClearLogsConfirm = ref(false)
const timeInterval = ref(null)
const parsedVenues = ref([])
const currentLevel = ref(0)
const linkLevelProgress = ref(null)
const linkLevelStats = ref(null)

// Venue presets for quick selection
const venuePresets = ref([
  {
    name: 'Test (Grøndal Only)',
    venues: 'Grøndal MultiCenter'
  },
  {
    name: 'Updated (Grøndal Lokale 28)',
    venues: 'Grøndal MultiCenter, lokale 28'
  },
  {
    name: 'Multiple Venues',
    venues: 'Grøndal MultiCenter, lokale 28; Arena Nord; Sportshall Øst'
  },
  {
    name: 'All Copenhagen',
    venues: 'Grøndal MultiCenter; Øbro Hallen; Rødovre Centrum Arena'
  }
])

// Initialize default settings
onMounted(() => {
  settings.value = {
    season: '2024/2025',
    linkStructure: 'https://www.bordtennisportalen.dk/DBTU/HoldTurnering/Stilling/#4.{season}.{pool}.{group}.{region}...',
    venues: 'Grøndal MultiCenter',
    autorun: true
  }
  
  // Parse initial venues
  parseVenues()
  
  // Update time until midnight every minute
  timeInterval.value = setInterval(updateTimeUntilMidnight, 60000)
})

onUnmounted(() => {
  if (timeInterval.value) {
    clearInterval(timeInterval.value)
  }
})

// Watch for scraper status changes
watch(() => scraperStatus.value, (newStatus) => {
  if (newStatus.linkLevelProgress) {
    linkLevelProgress.value = newStatus.linkLevelProgress
    currentLevel.value = newStatus.linkLevelProgress.level || 0
  }
  
  if (newStatus.linkLevelStats) {
    linkLevelStats.value = newStatus.linkLevelStats
  }
}, { deep: true })

// Computed properties
const now = ref(new Date())
const timeUntilMidnight = computed(() => {
  const midnight = new Date()
  midnight.setHours(24, 0, 0, 0)
  const diff = midnight - now.value
  return Math.floor(diff / (1000 * 60))
})

// Methods
const parseVenues = () => {
  if (!settings.value.venues) {
    parsedVenues.value = []
    return
  }
  
  // Parse venues from multiple formats
  const venues = settings.value.venues
    .split(/[;\n]/)
    .map(venue => venue.trim())
    .filter(venue => venue.length > 0)
  
  parsedVenues.value = venues
}

const removeVenue = (index) => {
  parsedVenues.value.splice(index, 1)
  settings.value.venues = parsedVenues.value.join('; ')
}

const applyVenuePreset = (preset) => {
  settings.value.venues = preset.venues
  parseVenues()
  addNotification(`Applied preset: ${preset.name}`, 'success')
}

const getLevelName = (level) => {
  const names = {
    1: 'Unions',
    2: 'Age Groups', 
    3: 'Pools',
    4: 'Matches',
    5: 'Filtering'
  }
  return names[level] || 'Unknown'
}

const getCurrentLevelDescription = () => {
  if (currentLevel.value === 0) return 'Ready to start navigation'
  if (currentLevel.value <= 5) return `Currently at: ${getLevelName(currentLevel.value)}`
  return 'Navigation complete'
}

const testLinkLevels = async () => {
  if (parsedVenues.value.length === 0) {
    addNotification('Please enter at least one venue', 'error')
    return
  }
  
  try {
    currentLevel.value = 1
    addNotification('Starting link level navigation test...', 'info')
    
    // Simulate link level progression
    const levels = ['Unions', 'Age Groups', 'Pools', 'Matches', 'Filtering']
    
    for (let i = 0; i < levels.length; i++) {
      currentLevel.value = i + 1
      linkLevelProgress.value = {
        currentLevel: levels[i],
        level: i + 1,
        processed: Math.floor((i + 1) * 10),
        total: 50,
        currentItem: `Processing ${levels[i].toLowerCase()}...`
      }
      
      scraperStatus.value.currentActivity = `Testing Level ${i + 1}: ${levels[i]}`
      scraperStatus.value.isRunning = true
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    
    // Mock results
    linkLevelStats.value = {
      unions: 3,
      ageGroups: 12,
      pools: 24,
      matches: 150
    }
    
    scraperStatus.value.isRunning = false
    scraperStatus.value.currentActivity = ''
    linkLevelProgress.value = null
    currentLevel.value = 0
    
    addNotification('Link level test completed successfully!', 'success')
    
  } catch (error) {
    scraperStatus.value.isRunning = false
    linkLevelProgress.value = null
    currentLevel.value = 0
    addNotification(`Link level test failed: ${error.message}`, 'error')
  }
}

const toggleAutorun = async () => {
  settings.value.autorun = !settings.value.autorun
  await updateSettings({ 
    autorun: settings.value.autorun,
    venues: parsedVenues.value
  })
  
  addNotification(
    `Autorun ${settings.value.autorun ? 'enabled' : 'disabled'}`,
    'success'
  )
}

const runScraper = async () => {
  if (parsedVenues.value.length === 0) {
    addNotification('Please enter at least one venue name', 'error')
    return
  }
  
  try {
    currentLevel.value = 1
    await startScraping({
      venues: parsedVenues.value,
      season: settings.value.season,
      linkStructure: settings.value.linkStructure
    })
  } catch (error) {
    currentLevel.value = 0
    addNotification(`Failed to start scraper: ${error.message}`, 'error')
  }
}

const clearAllMatches = async () => {
  try {
    await clearMatches()
    linkLevelStats.value = null
    addNotification('All matches cleared successfully', 'success')
  } catch (error) {
    addNotification(`Failed to clear matches: ${error.message}`, 'error')
  }
  showClearMatchesConfirm.value = false
}

const clearAllLogs = async () => {
  try {
    await clearLogs()
    addNotification('All logs cleared successfully', 'success')
  } catch (error) {
    addNotification(`Failed to clear logs: ${error.message}`, 'error')
  }
  showClearLogsConfirm.value = false
}

const formatDateTime = (dateTime) => {
  return new Date(dateTime).toLocaleString()
}

const updateTimeUntilMidnight = () => {
  now.value = new Date()
}
</script>