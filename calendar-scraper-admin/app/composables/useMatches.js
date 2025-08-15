// composables/useMatches.js
import { ref } from 'vue';
import axios from 'axios';

export function useMatches() {
    const matches = ref([]);
    const loading = ref(false);
    const error = ref(null);

    const fetchMatches = async (season = '2024/2025') => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('http://localhost:3001/api/v1/scraper/matches', {
                params: { season },
                timeout: 10000
            });
            if (response.data.success) {
                matches.value = response.data.matches;
            } else {
                throw new Error(response.data.message || 'Failed to fetch matches');
            }
        } catch (err) {
            error.value = err.message;
            console.error('Error fetching matches:', err);
        } finally {
            loading.value = false;
        }
    };

    const clearMatches = async () => {
        try {
            await axios.delete('http://localhost:3001/api/v1/scraper/matches');
            matches.value = [];
        } catch (err) {
            console.error('Error clearing matches:', err);
            throw err;
        }
    };

    return { matches, loading, error, fetchMatches, clearMatches };
}