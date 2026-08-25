import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as Location from 'expo-location';
import { colors, radius, spacing } from '../theme';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabaseClient';

const ADMIN_EMAIL = 'kreeadiv@gmail.com';
const TIER_PRIORITY = ['haven', 'friendly', 'possible'];

// Combines every signed-in user's rating for one place into a single
// community view: the most-voted WFPB tier, the average WFPB star rating,
// and the most recent tip left by anyone.
function aggregateRatings(ratingRows, userId) {
  if (!ratingRows || ratingRows.length === 0) return null;
  const tierCounts = {};
  let wfpbSum = 0;
  let wfpbCount = 0;
  let latestTip = null;
  let latestTipDate = null;
  let mine = null;

  ratingRows.forEach((r) => {
    if (r.tier_vote) tierCounts[r.tier_vote] = (tierCounts[r.tier_vote] || 0) + 1;
    if (r.wfpb_stars) {
      wfpbSum += r.wfpb_stars;
      wfpbCount += 1;
    }
    if (r.tip && (!latestTipDate || r.updated_at > latestTipDate)) {
      latestTip = r.tip;
      latestTipDate = r.updated_at;
    }
    if (userId && r.user_id === userId) mine = r;
  });

  let topTier = null;
  let topCount = 0;
  Object.entries(tierCounts).forEach(([tier, count]) => {
    if (count > topCount || (count === topCount && TIER_PRIORITY.indexOf(tier) < TIER_PRIORITY.indexOf(topTier))) {
      topTier = tier;
      topCount = count;
    }
  });

  return {
    tier: topTier,
    wfpbAvg: wfpbCount ? wfpbSum / wfpbCount : null,
    tip: latestTip,
    count: ratingRows.length,
    mine,
  };
}

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

// ── APB COMMUNITY DATA ──────────────────────────────────────────
// Ported directly from apb-nearby.html. Keyed by Google Place ID.
// In production this comes from Supabase; for now it's local, same as the web prototype.
const APB_COMMUNITY_DATA = {
  ChIJKzpW9PExVIgRB_lkoO5aPCQ: { tier: 'friendly', wto: "Ask about oil-free prep. Menu rotates - check their Instagram for current veg specials." },
  ChIJt8e4nYw5VIgRDMCdh_dqZ2I: { tier: 'haven', wto: 'Stock up on seasonal produce, bulk grains, and legumes. Best WFPB pantry shopping near Monroe.' },
  ChIJgxW7cLUwVIgRD_tJzmzNyPY: { tier: 'possible', wto: 'Produce section, dried beans, lentils, rice and grains. Good for everyday staples.' },
  ChIJI0CXR_w7VIgR_5HJPYqq8uw: { tier: 'possible', wto: 'Call ahead to ask about plant-based prep without oil. Rice and peas and vegetable dishes are your best bet.' },
  ChIJD0aMOtYlVIgR_hc3kePlw3U: { tier: 'friendly', wto: 'Ask Yanni directly about oil-free prep - the kitchen is accommodating.' },
  ChIJuzWMj_YdVIgRajR1bJ0e5fA: { tier: 'possible', wto: 'Ask for grilled mushroom bowls without oil. Skip the fries and fried items.' },
  ChIJFcgZqs9_hYARZzkB8L40ZDI: { tier: 'friendly', wto: 'Tell your server you eat whole food plant-based - they have a printed list and adapt dishes. Mushroom chowder and king oysters can be made oil-free.' },
  ChIJ7Xdl_qEfVIgRHpOpGMREYEY: { tier: 'possible', wto: 'Rainbow wrap and pressed juices are most WFPB-aligned. Skip nachos, elote ribs, and fried items.' },
  ChIJraDu1__hVogR7xixAzNcKwo: { tier: 'friendly', wto: 'Power Bowl and taco salad (dressing on the side) are most WFPB-aligned. Skip the chikie bites.' },
  ChIJtfNvQAChVogRFEKAr1RTAHM: { tier: 'possible', wto: 'Soul Bowl (grilled mushrooms, rice, sweet potatoes, black-eyed peas) - ask for oil-free. Skip the BBQ ribs.' },
  ChIJFWApelqhVogRsYXI3XbODu4: { tier: 'possible', wto: 'Ask about lighter preparations. Oyster mushroom sandwich without sauce. Limited Thu-Sun only.' },
  ChIJ6yQf5BkgVIgRTQ_MHoKeLV0: { tier: 'possible', wto: 'Bean-based chili and collard greens are most WFPB-aligned. Skip the carrot bacon and burgers.' },
  ChIJM6vihBSeVogRy6Qw_JteorU: { tier: 'haven', wto: 'Bulk bins, organic produce, plant milks, nutritional yeast. Hot bar - ask about oil-free options.' },
  ChIJx47_MM0nVIgRiqiMCJ90RLc: { tier: 'haven', wto: 'Bulk bins, organic produce, plant milks. Upstairs dining area. Closest Whole Foods to Monroe.' },
  ChIJVU_E6tOCVogRhv04rFpH3HI: { tier: 'haven', wto: 'Supplement section (B12, nooch), plant milks, organic produce. Open 7 AM daily.' },
  ChIJyX3YAq4fVIgRtdy_FFdUvnY: { tier: 'haven', wto: "Fresh produce, bulk bins. Near Oh My Soul and Soul Miner's Garden - great combo trip." },
  ChIJkRJNZoyfVogRmWLdSIS3sFA: { tier: 'haven', wto: 'Best value organic staples in Charlotte. Frozen veggies, canned legumes, whole grains, plant milks.' },
  ChIJgZApsnudVogRhjsY5IDyYuQ: { tier: 'haven', wto: "Closest TJ's to Monroe. Right next to Sanctuary Bistro on Rea Rd - perfect combo trip." },
  ChIJfQzmipmfVogRBHP01F5_IME: { tier: 'friendly', wto: 'B12 supplements, nutritional yeast, alkaline water. Good for hard-to-find WFPB supplements. Closed Sundays.' },
  ChIJPfuWb7GFVogR00e11ZThvcg: { tier: 'haven', wto: 'Hot bar - ask about oil-free. Organic produce, clean-label condiments. Bakery/meat close ~6 PM.' },
  'ChIJRV8tx0YlVIgRt4122FOwy-I': { tier: 'possible', wto: 'Build your own salad with lots of ingredient choices, but the only oil-free dressing option is balsamic vinegar. APB tip: bring your own dressing from home for a better salad experience. For pizza, the signature red tomato sauce is oil-free and there are plenty of veggie toppings. The crust does contain some oil so keep that in mind. Leave off the cheese, or ask for vegan cheese if that is something you include in your diet. Great option for going out with non-plant-based friends since everyone can build exactly what they want.' },
  // Mike's Vegan Grill (440 E McCullough Dr Ste 123, Charlotte, NC 28262) - pending a confirmed real Google Place ID; the one first provided already belongs to a different place above.
  'ChIJAY-aksBw_IgRlnL7iKm2zcQ': { tier: 'friendly', wto: 'Has a separate vegan/vegetarian menu - watch the key carefully since it can be confusing. Breakfast bowls and smoothies appeared to be WFPB. For dinner, salads and wraps are your best bet. APB recommends the Yummus Salad (watch out - there is also a chicken version) and ask to leave off the Mediterranean red wine dressing. The Latin Wrap is also excellent. Ingredients are fresh and flavorful throughout. The hummus may contain oil so keep that in mind. Always check the ingredients of whichever dish you try.' },
};

const SEARCH_TYPES = {
  all: ['vegan_restaurant', 'vegetarian_restaurant', 'restaurant', 'grocery_store', 'supermarket', 'health_food_store', 'meal_takeaway', 'cafe'],
  restaurant: ['vegan_restaurant', 'vegetarian_restaurant', 'restaurant'],
  grocery: ['grocery_store', 'supermarket', 'health_food_store'],
  health: ['health_food_store'],
  takeaway: ['meal_takeaway'],
  cafe: ['cafe'],
};

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'restaurant', label: '🍽 Restaurants' },
  { key: 'grocery', label: '🛒 Grocers' },
  { key: 'health', label: '🌿 Health Food' },
  { key: 'takeaway', label: '🥡 Takeaway' },
  { key: 'cafe', label: '☕ Cafés' },
];

const TIER_OPTIONS = [
  { key: 'haven', label: '🌱 Haven', bg: '#d8f3dc', text: '#1b4332' },
  { key: 'friendly', label: '🌿 Friendly', bg: '#e8f5e9', text: colors.leaf },
  { key: 'possible', label: '🍃 Possible', bg: '#fff8e1', text: '#c8963e' },
  { key: 'unrated', label: '❓ Not Yet Rated', bg: '#f5f5f5', text: colors.muted },
  { key: 'notwfpb', label: '🚫 Not WFPB', bg: '#fee2e2', text: '#991b1b' },
];

const TIER_LABELS = {
  haven: '🌱 WFPB Haven',
  friendly: '🌿 WFPB Friendly',
  possible: '🍃 WFPB Possible',
  unrated: '❓ Not Yet Rated',
};

const RADIUS_OPTIONS = [
  { key: '5000', label: 'Within 3 miles' },
  { key: '8000', label: 'Within 5 miles' },
  { key: '16000', label: 'Within 10 miles' },
  { key: '32000', label: 'Within 20 miles' },
  { key: '48000', label: 'Within 30 miles' },
];

const CATEGORY_ICON = { restaurant: '🍽️', grocery: '🛒', health: '🌿', takeaway: '🥡', cafe: '☕' };

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function categorize(types) {
  const t = types || [];
  if (t.includes('grocery_store') || t.includes('supermarket')) return 'grocery';
  if (t.includes('health_food_store')) return 'health';
  if (t.includes('meal_takeaway')) return 'takeaway';
  if (t.includes('cafe')) return 'cafe';
  return 'restaurant';
}

function enrichPlace(p, userLat, userLng) {
  const apb = APB_COMMUNITY_DATA[p.id] || null;
  const loc = p.location || {};
  const distanceM = haversineMeters(userLat, userLng, loc.latitude, loc.longitude);
  return {
    id: p.id,
    name: p.displayName?.text || 'Unknown place',
    address: p.formattedAddress || '',
    lat: loc.latitude,
    lng: loc.longitude,
    rating: p.rating || null,
    userRatingCount: p.userRatingCount || null,
    types: p.types || [],
    category: categorize(p.types),
    apb,
    tier: apb?.tier || 'unrated',
    wto: apb?.wto || null,
    apbWfpb: apb?.wfpb_rating || null,
    distanceM,
    distanceMi: (distanceM / 1609.34).toFixed(1),
  };
}

// Same shape as enrichPlace(), for a place a user typed in manually instead
// of one that came back from Google's search.
function enrichCommunityPlace(row, userLat, userLng) {
  const distanceM = haversineMeters(userLat, userLng, row.lat, row.lng);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    rating: null,
    userRatingCount: null,
    types: [],
    category: row.category,
    apb: null,
    tier: row.tier_vote || 'unrated',
    wto: row.why_wfpb || null,
    apbWfpb: null,
    distanceM,
    distanceMi: (distanceM / 1609.34).toFixed(1),
    communityAdded: true,
    addedBy: row.submitted_by,
  };
}

// A row from saved_places, shaped to display like a search result card
// (minus a live Google rating, which we don't re-fetch for saved items).
function enrichSavedPlace(row) {
  return {
    id: row.place_id,
    name: row.place_name,
    address: row.place_address || '',
    rating: null,
    userRatingCount: null,
    types: [],
    category: row.place_category || 'restaurant',
    apb: null,
    tier: 'unrated',
    wto: null,
    apbWfpb: null,
    distanceM: null,
    distanceMi: null,
    communityAdded: !!row.is_community,
    addedBy: null,
  };
}

export default function NearbyScreen() {
  const { session } = useAuth();
  const isAdmin = session?.user?.email === ADMIN_EMAIL;
  const [userLoc, setUserLoc] = useState(null); // { lat, lng }
  const [locationLabel, setLocationLabel] = useState('Not detected yet');
  const [locating, setLocating] = useState(false);
  const [citySearch, setCitySearch] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [radiusM, setRadiusM] = useState('8000');
  const [activeTiers, setActiveTiers] = useState(new Set(['haven', 'friendly', 'possible', 'unrated', 'notwfpb']));
  const [activeType, setActiveType] = useState('all');
  const [results, setResults] = useState([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [ratingModal, setRatingModal] = useState(null); // { id, name }
  const [overallStars, setOverallStars] = useState(0);
  const [wfpbStars, setWfpbStars] = useState(0);
  const [tierVote, setTierVote] = useState(null);
  const [tipText, setTipText] = useState('');

  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagTarget, setFlagTarget] = useState(null); // { id, name }
  const [flagReason, setFlagReason] = useState(null);
  const [flagDetails, setFlagDetails] = useState('');
  const [showFlagsQueue, setShowFlagsQueue] = useState(false);
  const [flagsList, setFlagsList] = useState([]);
  const [openFlagsCount, setOpenFlagsCount] = useState(0);

  const [showAddPlaceModal, setShowAddPlaceModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addCategory, setAddCategory] = useState('restaurant');
  const [addWhy, setAddWhy] = useState('');
  const [addTier, setAddTier] = useState(null);
  const [addBy, setAddBy] = useState('');
  const [addingPlace, setAddingPlace] = useState(false);

  const [viewTab, setViewTab] = useState('search'); // 'search' | 'saved'
  const [savedPlaceIds, setSavedPlaceIds] = useState(new Set());
  const [savedResults, setSavedResults] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  useEffect(() => {
    if (!session) {
      setSavedPlaceIds(new Set());
      return;
    }
    supabase
      .from('saved_places')
      .select('place_id')
      .eq('user_id', session.user.id)
      .then(({ data, error }) => {
        if (!error) setSavedPlaceIds(new Set((data || []).map((r) => r.place_id)));
      });
  }, [session]);

  async function refreshSavedResults() {
    if (!session) {
      setSavedResults([]);
      return;
    }
    setLoadingSaved(true);
    const { data, error } = await supabase
      .from('saved_places')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });
    if (error) {
      setLoadingSaved(false);
      return;
    }
    let enriched = (data || []).map((row) => enrichSavedPlace(row));
    const ids = enriched.map((p) => p.id);
    if (ids.length > 0) {
      const { data: ratingRows, error: ratingsError } = await supabase
        .from('place_ratings')
        .select('*')
        .in('place_id', ids);

      const uniqueNames = [...new Set(enriched.map((p) => p.name).filter(Boolean))];
      let chainRows = [];
      if (uniqueNames.length > 0) {
        const { data: nameRows, error: nameError } = await supabase
          .from('place_ratings')
          .select('*')
          .in('place_name', uniqueNames);
        if (!nameError && nameRows) chainRows = nameRows;
      }

      if (!ratingsError && ratingRows) {
        const byPlace = {};
        ratingRows.forEach((r) => {
          (byPlace[r.place_id] = byPlace[r.place_id] || []).push(r);
        });
        const byName = {};
        chainRows.forEach((r) => {
          (byName[r.place_name] = byName[r.place_name] || []).push(r);
        });
        enriched = enriched.map((p) => {
          const agg = aggregateRatings(byPlace[p.id], session.user.id);
          if (agg) {
            return {
              ...p,
              tier: agg.tier || p.tier,
              apbWfpb: agg.wfpbAvg ?? p.apbWfpb,
              wto: agg.tip ?? p.wto,
              ratingCount: agg.count,
              myRating: agg.mine || null,
            };
          }
          const otherRows = (byName[p.name] || []).filter((r) => r.place_id !== p.id);
          const chainAgg = aggregateRatings(otherRows, null);
          if (chainAgg) {
            return {
              ...p,
              tier: chainAgg.tier || p.tier,
              apbWfpb: chainAgg.wfpbAvg ?? p.apbWfpb,
              wto: chainAgg.tip ?? p.wto,
              ratingCount: chainAgg.count,
              chainFallback: true,
            };
          }
          return p;
        });
      }
    }
    setSavedResults(enriched);
    setLoadingSaved(false);
  }

  function selectTab(tab) {
    setViewTab(tab);
    if (tab === 'saved') refreshSavedResults();
  }

  async function toggleSave(place) {
    if (!session) {
      Alert.alert('Sign in required', `Sign in to save "${place.name}" to your favorites.`);
      return;
    }
    const isSaved = savedPlaceIds.has(place.id);
    if (isSaved) {
      setSavedPlaceIds((prev) => {
        const next = new Set(prev);
        next.delete(place.id);
        return next;
      });
      const { error } = await supabase
        .from('saved_places')
        .delete()
        .eq('user_id', session.user.id)
        .eq('place_id', place.id);
      if (error) {
        setSavedPlaceIds((prev) => new Set(prev).add(place.id));
        Alert.alert('Something went wrong', 'Could not remove this place. Please try again.');
        return;
      }
      setSavedResults((prev) => prev.filter((p) => p.id !== place.id));
    } else {
      setSavedPlaceIds((prev) => new Set(prev).add(place.id));
      const { error } = await supabase.from('saved_places').upsert(
        {
          user_id: session.user.id,
          place_id: place.id,
          place_name: place.name,
          place_address: place.address,
          place_category: place.category,
          is_community: !!place.communityAdded,
        },
        { onConflict: 'user_id,place_id' }
      );
      if (error) {
        setSavedPlaceIds((prev) => {
          const next = new Set(prev);
          next.delete(place.id);
          return next;
        });
        Alert.alert('Something went wrong', 'Could not save this place. Please try again.');
      }
    }
  }

  async function refreshFlagsCount() {
    if (!session) {
      setOpenFlagsCount(0);
      return;
    }
    const { data, error } = await supabase.from('place_flags').select('status');
    if (!error) setOpenFlagsCount((data || []).filter((f) => f.status === 'open').length);
  }

  useEffect(() => {
    refreshFlagsCount();
  }, [session]);

  const runNearbySearch = useCallback(
    async (lat, lng) => {
      if (!GOOGLE_API_KEY) {
        setSearchError('No Google API key configured yet (.env is missing EXPO_PUBLIC_GOOGLE_API_KEY).');
        return;
      }
      setLoadingResults(true);
      setSearchError(null);
      try {
        const includedTypes = SEARCH_TYPES[activeType] || SEARCH_TYPES.all;
        const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.primaryType',
          },
          body: JSON.stringify({
            includedTypes,
            maxResultCount: 20,
            locationRestriction: {
              circle: { center: { latitude: lat, longitude: lng }, radius: parseFloat(radiusM) },
            },
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data?.error?.message || 'Places search failed');
        }
        const places = data.places || [];
        let enriched = places.map((p) => enrichPlace(p, lat, lng));

        // Merge in community-added places (ones that don't show up in Google
        // search at all) that fall within the same category filter and radius.
        const { data: communityRows, error: communityError } = await supabase
          .from('user_submitted_places')
          .select('*')
          .not('lat', 'is', null);
        if (!communityError && communityRows) {
          const communityEnriched = communityRows
            .filter((row) => activeType === 'all' || row.category === activeType)
            .map((row) => enrichCommunityPlace(row, lat, lng))
            .filter((p) => p.distanceM <= parseFloat(radiusM));
          enriched = [...enriched, ...communityEnriched];
        }

        enriched = enriched.sort((a, b) => a.distanceM - b.distanceM);

        const ids = enriched.map((p) => p.id);
        if (ids.length > 0) {
          const { data: ratingRows, error: ratingsError } = await supabase
            .from('place_ratings')
            .select('*')
            .in('place_id', ids);

          // Also pull ratings left at any OTHER location sharing the same
          // name - chains like MOD Pizza usually have the same menu
          // everywhere, so a tip from one location is useful at another
          // that has no ratings of its own yet.
          const uniqueNames = [...new Set(enriched.map((p) => p.name).filter(Boolean))];
          let chainRows = [];
          if (uniqueNames.length > 0) {
            const { data: nameRows, error: nameError } = await supabase
              .from('place_ratings')
              .select('*')
              .in('place_name', uniqueNames);
            if (!nameError && nameRows) chainRows = nameRows;
          }

          if (!ratingsError && ratingRows) {
            const byPlace = {};
            ratingRows.forEach((r) => {
              (byPlace[r.place_id] = byPlace[r.place_id] || []).push(r);
            });
            const byName = {};
            chainRows.forEach((r) => {
              (byName[r.place_name] = byName[r.place_name] || []).push(r);
            });
            enriched = enriched.map((p) => {
              const agg = aggregateRatings(byPlace[p.id], session?.user?.id);
              if (agg) {
                return {
                  ...p,
                  tier: agg.tier || p.tier,
                  apbWfpb: agg.wfpbAvg ?? p.apbWfpb,
                  wto: agg.tip ?? p.wto,
                  ratingCount: agg.count,
                  myRating: agg.mine || null,
                };
              }
              // No ratings at this exact location yet - fall back to other
              // locations of the same chain, if the community has rated any.
              if (!p.apb) {
                const otherRows = (byName[p.name] || []).filter((r) => r.place_id !== p.id);
                const chainAgg = aggregateRatings(otherRows, null);
                if (chainAgg) {
                  return {
                    ...p,
                    tier: chainAgg.tier || p.tier,
                    apbWfpb: chainAgg.wfpbAvg ?? p.apbWfpb,
                    wto: chainAgg.tip ?? p.wto,
                    ratingCount: chainAgg.count,
                    chainFallback: true,
                  };
                }
              }
              return p;
            });
          }
        }
        setResults(enriched);
      } catch (e) {
        setSearchError(e.message || 'Something went wrong reaching Google Places.');
        setResults([]);
      } finally {
        setLoadingResults(false);
      }
    },
    [activeType, radiusM, session]
  );

  const reverseGeocode = useCallback(async (lat, lng) => {
    if (!GOOGLE_API_KEY) return;
    try {
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`
      );
      const data = await resp.json();
      if (data.results && data.results[0]) {
        const comps = data.results[0].address_components;
        const city = comps.find((c) => c.types.includes('locality'))?.long_name || '';
        const state = comps.find((c) => c.types.includes('administrative_area_level_1'))?.short_name || '';
        setLocationLabel(city && state ? `${city}, ${state}` : data.results[0].formatted_address);
      } else {
        setLocationLabel(`${lat.toFixed(3)}°, ${lng.toFixed(3)}°`);
      }
    } catch {
      setLocationLabel(`Near ${lat.toFixed(3)}°, ${lng.toFixed(3)}°`);
    }
  }, []);

  async function detectLocation() {
    setLocating(true);
    setSearchError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocating(false);
        setLocationLabel('Location permission denied');
        Alert.alert(
          'Location permission needed',
          'APB needs location access to find places near you. You can enable it in your phone Settings, or just search a city below instead.'
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setUserLoc({ lat, lng });
      reverseGeocode(lat, lng);
      runNearbySearch(lat, lng);
    } catch (e) {
      setSearchError("Couldn't get your location. Try searching a city instead.");
    } finally {
      setLocating(false);
    }
  }

  async function searchByCity() {
    const q = citySearch.trim();
    if (!q || !GOOGLE_API_KEY) return;
    setLoadingResults(true);
    setSearchError(null);
    try {
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${GOOGLE_API_KEY}`
      );
      const data = await resp.json();
      if (data.results && data.results[0]) {
        const loc = data.results[0].geometry.location;
        setUserLoc({ lat: loc.lat, lng: loc.lng });
        setLocationLabel(data.results[0].formatted_address);
        runNearbySearch(loc.lat, loc.lng);
      } else {
        setLoadingResults(false);
        setSearchError(`No location found for "${q}". Try a different city or zip code.`);
      }
    } catch {
      setLoadingResults(false);
      setSearchError('Something went wrong looking up that location.');
    }
  }

  function toggleTier(tier) {
    setActiveTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      if (next.size === 0) next.add(tier);
      return next;
    });
  }

  function selectType(type) {
    setActiveType(type);
    if (userLoc) {
      // re-run search with new type filter
      setTimeout(() => runNearbySearch(userLoc.lat, userLoc.lng), 0);
    }
  }

  const filteredResults = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    return results.filter((p) => activeTiers.has(p.tier) && (!q || p.name.toLowerCase().includes(q)));
  }, [results, activeTiers, nameFilter]);

  const filteredSavedResults = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    return savedResults.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [savedResults, nameFilter]);

  function openRating(place) {
    if (!session) {
      Alert.alert('Sign in required', 'Sign in to rate a place for WFPB.');
      return;
    }
    setRatingModal(place);
    const mine = place.myRating;
    setOverallStars(mine?.overall_stars || 0);
    setWfpbStars(mine?.wfpb_stars || 0);
    setTierVote(mine?.tier_vote || null);
    setTipText(mine?.tip || '');
  }

  async function submitRating() {
    if (!overallStars && !wfpbStars) {
      Alert.alert('Add a rating', 'Please add at least one star rating.');
      return;
    }
    const id = ratingModal.id;
    const name = ratingModal.name;
    const { error } = await supabase.from('place_ratings').upsert(
      {
        user_id: session.user.id,
        place_id: id,
        place_name: name,
        overall_stars: overallStars || null,
        wfpb_stars: wfpbStars || null,
        tier_vote: tierVote || null,
        tip: tipText.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,place_id' }
    );
    if (error) {
      Alert.alert('Something went wrong', 'Could not save your rating. Please try again.');
      return;
    }
    setRatingModal(null);
    Alert.alert('Thanks!', 'Your rating is saved and counts toward the community rating.');
    // Refresh so the card reflects the updated community aggregate.
    if (userLoc) runNearbySearch(userLoc.lat, userLoc.lng);
  }

  function reportPlace(id, name) {
    if (!session) {
      Alert.alert('Sign in required', 'Sign in to flag a place.');
      return;
    }
    setFlagTarget({ id, name });
    setFlagReason(null);
    setFlagDetails('');
    setShowFlagModal(true);
  }

  async function submitFlag() {
    if (!flagReason) {
      Alert.alert('Missing info', 'Please select a reason.');
      return;
    }
    const { error } = await supabase.from('place_flags').insert({
      user_id: session.user.id,
      place_id: flagTarget.id,
      place_name: flagTarget.name,
      reason: flagReason,
      details: flagDetails.trim() || null,
    });
    setShowFlagModal(false);
    if (error) {
      Alert.alert('Something went wrong', 'Could not submit your report. Please try again.');
      return;
    }
    refreshFlagsCount();
    Alert.alert('Thanks for flagging this', 'Our team will take a look.');
  }

  async function openFlagsQueue() {
    if (!session) {
      Alert.alert('Sign in required', 'Sign in to see the flags queue.');
      return;
    }
    const { data, error } = await supabase
      .from('place_flags')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setFlagsList(data || []);
    setShowFlagsQueue(true);
  }

  async function updateFlagStatus(id, status) {
    const { error } = await supabase.from('place_flags').update({ status }).eq('id', id);
    if (error) {
      Alert.alert('Something went wrong', 'Could not update this flag. Please try again.');
      return;
    }
    setFlagsList((prev) => prev.map((f) => (f.id === id ? { ...f, status } : f)));
    refreshFlagsCount();
  }

  function openDirections(place) {
    const url = place.communityAdded
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${place.id}`;
    Linking.openURL(url).catch(() => {});
  }

  function openAddPlaceModal() {
    if (!session) {
      Alert.alert('Sign in required', 'Sign in to add a place.');
      return;
    }
    setAddName('');
    setAddAddress('');
    setAddCategory('restaurant');
    setAddWhy('');
    setAddTier(null);
    setAddBy(session.user.user_metadata?.display_name || '');
    setShowAddPlaceModal(true);
  }

  async function submitAddPlace() {
    const name = addName.trim();
    const address = addAddress.trim();
    const why = addWhy.trim();
    if (!name) {
      Alert.alert('Missing info', 'Please enter the place name.');
      return;
    }
    if (!address) {
      Alert.alert('Missing info', 'Please enter the full address.');
      return;
    }
    if (!why) {
      Alert.alert('Missing info', "Please tell us why it's WFPB-friendly.");
      return;
    }
    if (!GOOGLE_API_KEY) {
      Alert.alert('Something went wrong', 'No Google API key configured yet.');
      return;
    }

    setAddingPlace(true);
    try {
      const resp = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_API_KEY}`
      );
      const geo = await resp.json();
      if (!geo.results || !geo.results[0]) {
        setAddingPlace(false);
        Alert.alert('Address not found', "We couldn't locate that address. Please double-check it and try again.");
        return;
      }
      const loc = geo.results[0].geometry.location;

      const { error } = await supabase.from('user_submitted_places').insert({
        user_id: session.user.id,
        name,
        address: geo.results[0].formatted_address,
        category: addCategory,
        why_wfpb: why,
        tier_vote: addTier,
        submitted_by: addBy.trim() || 'Anonymous',
        lat: loc.lat,
        lng: loc.lng,
      });
      setAddingPlace(false);
      if (error) {
        Alert.alert('Something went wrong', 'Could not add this place. Please try again.');
        return;
      }
      setShowAddPlaceModal(false);
      Alert.alert(
        `Thanks for adding ${name}!`,
        "It's live now and will show up in search results if it's within your selected radius."
      );
      if (userLoc) runNearbySearch(userLoc.lat, userLoc.lng);
    } catch (e) {
      setAddingPlace(false);
      Alert.alert('Something went wrong', 'Could not look up that address. Please try again.');
    }
  }


  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Find Plant-Friendly Places Near You</Text>
              <Text style={styles.subtext}>
                Real restaurants, grocers, and markets - rated by the APB community for WFPB alignment.
              </Text>
            </View>
            <TouchableOpacity style={styles.flagsQueueBtn} onPress={openFlagsQueue}>
              <Text style={styles.flagsQueueBtnText}>🚩</Text>
              {openFlagsCount > 0 && (
                <View style={styles.flagsBadge}>
                  <Text style={styles.flagsBadgeText}>{openFlagsCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.viewTabRow}>
            <TouchableOpacity
              style={[styles.viewTabBtn, viewTab === 'search' && styles.viewTabBtnActive]}
              onPress={() => selectTab('search')}
            >
              <Text style={[styles.viewTabBtnText, viewTab === 'search' && styles.viewTabBtnTextActive]}>
                🔍 Search
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewTabBtn, viewTab === 'saved' && styles.viewTabBtnActive]}
              onPress={() => selectTab('saved')}
            >
              <Text style={[styles.viewTabBtnText, viewTab === 'saved' && styles.viewTabBtnTextActive]}>
                ♡ Saved ({savedPlaceIds.size})
              </Text>
            </TouchableOpacity>
          </View>

          {viewTab === 'search' && (
            <TouchableOpacity style={styles.addPlaceBtn} onPress={openAddPlaceModal}>
              <Text style={styles.addPlaceBtnText}>+ Add a Place We're Missing</Text>
            </TouchableOpacity>
          )}

          {viewTab === 'search' && (
            <>
              <View style={styles.locationBar}>
                <Text style={{ fontSize: 20 }}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationLabel}>Your location</Text>
                  <Text style={styles.locationValue}>{locationLabel}</Text>
                </View>
                <TouchableOpacity style={styles.locateBtn} onPress={detectLocation} disabled={locating}>
                  {locating ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.locateBtnText}>📍 {userLoc ? 'Refresh' : 'Use My Location'}</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Or search any city, zip, or address…"
                  placeholderTextColor={colors.muted}
                  value={citySearch}
                  onChangeText={setCitySearch}
                  onSubmitEditing={searchByCity}
                />
                <TouchableOpacity style={styles.searchBtn} onPress={searchByCity}>
                  <Text style={styles.searchBtnText}>Search</Text>
                </TouchableOpacity>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radiusRow}>
                {RADIUS_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.radiusPill, radiusM === r.key && styles.radiusPillActive]}
                    onPress={() => {
                      setRadiusM(r.key);
                      if (userLoc) setTimeout(() => runNearbySearch(userLoc.lat, userLoc.lng), 0);
                    }}
                  >
                    <Text style={[styles.radiusPillText, radiusM === r.key && styles.radiusPillTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.tierRow}>
                {TIER_OPTIONS.map((t) => {
                  const active = activeTiers.has(t.key);
                  return (
                    <TouchableOpacity
                      key={t.key}
                      style={[
                        styles.tierPill,
                        { backgroundColor: t.bg, opacity: active ? 1 : 0.35 },
                        active && { borderColor: t.text },
                      ]}
                      onPress={() => toggleTier(t.key)}
                    >
                      <Text style={[styles.tierPillText, { color: t.text }]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
                {TYPE_FILTERS.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.typePill, activeType === t.key && styles.typePillActive]}
                    onPress={() => selectType(t.key)}
                  >
                    <Text style={[styles.typePillText, activeType === t.key && styles.typePillTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
        </View>

        <View style={styles.nameFilterRow}>
          <TextInput
            style={styles.nameFilterInput}
            placeholder={
              viewTab === 'search' ? 'Filter these results by name (e.g. MOD Pizza)' : 'Filter your saved places by name'
            }
            placeholderTextColor={colors.muted}
            value={nameFilter}
            onChangeText={setNameFilter}
          />
          {nameFilter.length > 0 && (
            <TouchableOpacity onPress={() => setNameFilter('')} style={styles.nameFilterClear}>
              <Text style={styles.nameFilterClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.resultsHeader}>
          <Text style={styles.resultsCount}>
            {viewTab === 'search'
              ? loadingResults
                ? 'Searching…'
                : results.length
                ? `${filteredResults.length} place${filteredResults.length !== 1 ? 's' : ''} found · Tap ⭐ to rate for WFPB`
                : '-'
              : loadingSaved
              ? 'Loading…'
              : `${filteredSavedResults.length} saved place${filteredSavedResults.length !== 1 ? 's' : ''}`}
          </Text>
        </View>

        <View style={styles.grid}>
          {viewTab === 'search' && loadingResults ? (
            <ActivityIndicator size="large" color={colors.leaf} style={{ marginTop: spacing.xl }} />
          ) : viewTab === 'search' && searchError ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>⚠️</Text>
              <Text style={styles.emptyTitle}>Something went wrong</Text>
              <Text style={styles.emptyText}>{searchError}</Text>
            </View>
          ) : viewTab === 'search' && !userLoc ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🌍</Text>
              <Text style={styles.emptyTitle}>Find food anywhere</Text>
              <Text style={styles.emptyText}>
                Allow location access or search a city to find real plant-friendly restaurants and grocers near
                you - rated by the APB community for WFPB alignment.
              </Text>
            </View>
          ) : viewTab === 'search' && filteredResults.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🌿</Text>
              <Text style={styles.emptyTitle}>No plant-friendly places found here</Text>
              <Text style={styles.emptyText}>Try a wider radius, a different filter, or a different location.</Text>
            </View>
          ) : viewTab === 'saved' && loadingSaved ? (
            <ActivityIndicator size="large" color={colors.leaf} style={{ marginTop: spacing.xl }} />
          ) : viewTab === 'saved' && savedResults.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>♡</Text>
              <Text style={styles.emptyTitle}>No saved places yet</Text>
              <Text style={styles.emptyText}>Tap the ♡ on any search result to save it here.</Text>
            </View>
          ) : viewTab === 'saved' && filteredSavedResults.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>No saved places match "{nameFilter}".</Text>
            </View>
          ) : (
            (viewTab === 'search' ? filteredResults : filteredSavedResults).map((p) => (
              <View key={p.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderTop}>
                    <View style={styles.cardIcon}>
                      <Text style={{ fontSize: 18 }}>{CATEGORY_ICON[p.category] || '🍽️'}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardName}>{p.name}</Text>
                      <Text style={styles.cardAddr}>{p.address}</Text>
                    </View>
                  </View>
                  <View style={styles.cardMeta}>
                    {p.distanceMi != null && (
                      <Text style={styles.cardDistance}>📍 {p.distanceMi} mi away</Text>
                    )}
                    <View
                      style={[
                        styles.tierBadge,
                        { backgroundColor: TIER_OPTIONS.find((t) => t.key === p.tier)?.bg || '#f5f5f5' },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: '600',
                          color: TIER_OPTIONS.find((t) => t.key === p.tier)?.text || colors.muted,
                        }}
                      >
                        {TIER_LABELS[p.tier]}
                      </Text>
                    </View>
                    {p.communityAdded && (
                      <View style={styles.communityBadge}>
                        <Text style={styles.communityBadgeText}>👥 Added by {p.addedBy}</Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.dualRatings}>
                  <View style={[styles.ratingCol, styles.ratingColBorder]}>
                    <Text style={styles.ratingLabel}>Google Rating</Text>
                    {p.rating ? (
                      <>
                        <Text style={styles.ratingNum}>
                          {p.rating} {'★'.repeat(Math.round(p.rating))}
                          {'☆'.repeat(5 - Math.round(p.rating))}
                        </Text>
                        {p.userRatingCount ? (
                          <Text style={styles.ratingSub}>{p.userRatingCount.toLocaleString()} Google reviews</Text>
                        ) : null}
                      </>
                    ) : (
                      <Text style={styles.ratingNone}>No Google rating</Text>
                    )}
                  </View>
                  <View style={styles.ratingCol}>
                    <Text style={styles.ratingLabel}>🌱 WFPB Rating</Text>
                    {p.apbWfpb ? (
                      <Text style={styles.ratingNum}>
                        {p.apbWfpb.toFixed(1)} {'★'.repeat(Math.round(p.apbWfpb))}
                        {'☆'.repeat(5 - Math.round(p.apbWfpb))}
                      </Text>
                    ) : (
                      <Text style={styles.ratingNone}>No ratings yet</Text>
                    )}
                    {!!p.ratingCount && (
                      <Text style={styles.ratingSub}>
                        {p.ratingCount} community rating{p.ratingCount !== 1 ? 's' : ''}
                      </Text>
                    )}
                    <TouchableOpacity onPress={() => openRating(p)}>
                      <Text style={styles.rateLink}>
                        {p.myRating ? 'Update your rating →' : 'Rate for WFPB →'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.cardBody}>
                  {p.wto ? (
                    <View style={styles.wtoBox}>
                      <View style={styles.wtoHeader}>
                        <Text style={styles.wtoLabel}>
                          {p.tier === 'haven' ? '🌱' : p.tier === 'friendly' ? '🌿' : '🍃'} What to order
                        </Text>
                        <TouchableOpacity onPress={() => reportPlace(p.id, p.name)}>
                          <Text style={styles.wtoReport}>🚩 Report</Text>
                        </TouchableOpacity>
                      </View>
                      {p.chainFallback && (
                        <Text style={styles.chainNote}>
                          Based on other {p.name} locations - menu may vary here.
                        </Text>
                      )}
                      <Text style={styles.wtoText}>{p.wto}</Text>
                    </View>
                  ) : (
                    <Text style={styles.noInfoText}>No APB info yet for this place.</Text>
                  )}
                </View>

                <View style={styles.cardFooter}>
                  <TouchableOpacity style={styles.directionsBtn} onPress={() => openDirections(p)}>
                    <Text style={styles.directionsBtnText}>📍 Directions</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smIconBtn} onPress={() => openRating(p)}>
                    <Text>⭐</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smIconBtn, savedPlaceIds.has(p.id) && styles.smIconBtnActive]}
                    onPress={() => toggleSave(p)}
                  >
                    <Text style={savedPlaceIds.has(p.id) && styles.smIconTextActive}>
                      {savedPlaceIds.has(p.id) ? '♥' : '♡'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smIconBtn} onPress={() => reportPlace(p.id, p.name)}>
                    <Text>🚩</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={!!ratingModal} animationType="slide" transparent onRequestClose={() => setRatingModal(null)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Rate this place</Text>
              <Text style={styles.modalSub}>{ratingModal?.name}</Text>

              <Text style={styles.modalSecLabel}>⭐ Overall Experience</Text>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity key={n} onPress={() => setOverallStars(n)}>
                    <Text style={[styles.star, { color: colors.sun, opacity: n <= overallStars ? 1 : 0.25 }]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.modalSecLabel}>🌱 WFPB Rating</Text>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity key={n} onPress={() => setWfpbStars(n)}>
                    <Text style={[styles.star, { color: colors.leafLight, opacity: n <= wfpbStars ? 1 : 0.25 }]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.modalSecLabel}>🏷️ WFPB Tier</Text>
              {[
                { key: 'haven', title: 'WFPB Haven', desc: 'Whole food, plant-based eating is central to what this place does. Oil-free options exist without asking.' },
                { key: 'friendly', title: 'WFPB Friendly', desc: 'Not exclusively plant-based but genuinely accommodating. Good options, staff willing to modify.' },
                { key: 'possible', title: 'WFPB Possible', desc: 'Not plant-friendly by design but workable. May need modifications or piecing together from sides.' },
              ].map((tv) => (
                <TouchableOpacity
                  key={tv.key}
                  style={[styles.tierVoteBtn, tierVote === tv.key && styles.tierVoteBtnSelected]}
                  onPress={() => setTierVote(tv.key)}
                >
                  <Text style={styles.tierVoteTitle}>{tv.title}</Text>
                  <Text style={styles.tierVoteDesc}>{tv.desc}</Text>
                </TouchableOpacity>
              ))}

              <Text style={styles.modalSecLabel}>📝 Your tip (optional)</Text>
              <TextInput
                style={styles.modalTextarea}
                placeholder="What should WFPB eaters know?"
                placeholderTextColor={colors.muted}
                value={tipText}
                onChangeText={setTipText}
                multiline
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalSubmitBtn} onPress={submitRating}>
                  <Text style={styles.modalSubmitBtnText}>Submit Rating</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRatingModal(null)}>
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FLAG / REPORT MODAL */}
      <Modal
        visible={showFlagModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFlagModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🚩 Report a Problem</Text>
            <Text style={styles.modalSub}>{flagTarget?.name}</Text>

            <Text style={styles.modalSecLabel}>What's wrong?</Text>
            {['Incorrect information', "Place closed or doesn't exist", 'Duplicate listing', 'Other'].map(
              (reason) => (
                <TouchableOpacity
                  key={reason}
                  style={[styles.flagReasonBtn, flagReason === reason && styles.flagReasonBtnSelected]}
                  onPress={() => setFlagReason(reason)}
                >
                  <Text
                    style={[
                      styles.flagReasonBtnText,
                      flagReason === reason && styles.flagReasonBtnTextSelected,
                    ]}
                  >
                    {reason}
                  </Text>
                </TouchableOpacity>
              )
            )}

            <Text style={styles.modalSecLabel}>Details (optional)</Text>
            <TextInput
              style={styles.modalTextarea}
              placeholder="Tell us more about the problem..."
              placeholderTextColor={colors.muted}
              value={flagDetails}
              onChangeText={setFlagDetails}
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalSubmitBtn} onPress={submitFlag}>
                <Text style={styles.modalSubmitBtnText}>Submit Report</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowFlagModal(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FLAGS QUEUE MODAL */}
      <Modal
        visible={showFlagsQueue}
        animationType="slide"
        transparent
        onRequestClose={() => setShowFlagsQueue(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>🚩 Flagged Places</Text>
            <Text style={styles.modalSub}>
              {isAdmin ? 'Community reports awaiting review.' : "Reports you've submitted."}
            </Text>
            <ScrollView>
              {flagsList.length === 0 ? (
                <Text style={styles.flagsEmptyText}>No flags to show.</Text>
              ) : (
                flagsList.map((f) => (
                  <View key={f.id} style={styles.flagsQueueItem}>
                    <Text style={styles.flagsQueueItemName}>{f.place_name}</Text>
                    <Text style={styles.flagsQueueItemDate}>
                      {new Date(f.created_at).toLocaleDateString()} · {f.status}
                    </Text>
                    <Text style={styles.flagsQueueItemReason}>{f.reason}</Text>
                    {!!f.details && <Text style={styles.flagsQueueItemDetails}>{f.details}</Text>}
                    {isAdmin && f.status === 'open' && (
                      <View style={styles.flagsQueueActions}>
                        <TouchableOpacity
                          style={styles.flagsQueueActionBtn}
                          onPress={() => updateFlagStatus(f.id, 'dismissed')}
                        >
                          <Text style={styles.flagsQueueActionBtnText}>Dismiss</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.flagsQueueActionBtn, styles.flagsQueueActionBtnDanger]}
                          onPress={() => updateFlagStatus(f.id, 'resolved')}
                        >
                          <Text style={styles.flagsQueueActionBtnDangerText}>Resolved</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalCancelBtn, { marginTop: spacing.sm }]}
              onPress={() => setShowFlagsQueue(false)}
            >
              <Text style={styles.modalCancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ADD A PLACE MODAL */}
      <Modal
        visible={showAddPlaceModal}
        animationType="slide"
        onRequestClose={() => setShowAddPlaceModal(false)}
      >
        <SafeAreaView style={styles.safe}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
          >
          <ScrollView contentContainerStyle={styles.addPlaceScroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>🌱 Add a Place We're Missing</Text>
            <Text style={styles.modalSub}>
              For places that don't show up in search at all - a small local spot, a home-based
              business, etc. It'll be geocoded and show up in results within its area.
            </Text>

            <Text style={styles.modalSecLabel}>Place Name</Text>
            <TextInput
              style={styles.addPlaceInput}
              placeholder="e.g. Diane's Kitchen"
              placeholderTextColor={colors.muted}
              value={addName}
              onChangeText={setAddName}
            />

            <Text style={styles.modalSecLabel}>Full Address</Text>
            <TextInput
              style={styles.addPlaceInput}
              placeholder="Street, city, state, zip"
              placeholderTextColor={colors.muted}
              value={addAddress}
              onChangeText={setAddAddress}
            />

            <Text style={styles.modalSecLabel}>Category</Text>
            <View style={styles.addCatGrid}>
              {TYPE_FILTERS.filter((t) => t.key !== 'all').map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.addCatBtn, addCategory === t.key && styles.addCatBtnSelected]}
                  onPress={() => setAddCategory(t.key)}
                >
                  <Text
                    style={[styles.addCatBtnText, addCategory === t.key && styles.addCatBtnTextSelected]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.modalSecLabel}>Why is it WFPB-friendly?</Text>
            <TextInput
              style={[styles.addPlaceInput, styles.addPlaceTextarea]}
              placeholder="What can WFPB eaters get here? Any prep notes?"
              placeholderTextColor={colors.muted}
              value={addWhy}
              onChangeText={setAddWhy}
              multiline
            />

            <Text style={styles.modalSecLabel}>Suggested WFPB Tier (optional)</Text>
            {[
              { key: 'haven', title: 'WFPB Haven' },
              { key: 'friendly', title: 'WFPB Friendly' },
              { key: 'possible', title: 'WFPB Possible' },
              { key: 'notwfpb', title: 'Not WFPB - good to know about, but not really an option' },
            ].map((tv) => (
              <TouchableOpacity
                key={tv.key}
                style={[styles.tierVoteBtn, addTier === tv.key && styles.tierVoteBtnSelected]}
                onPress={() => setAddTier(tv.key)}
              >
                <Text style={styles.tierVoteTitle}>{tv.title}</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.modalSecLabel}>Your Name or Initials</Text>
            <TextInput
              style={styles.addPlaceInput}
              placeholder="e.g. Dana M."
              placeholderTextColor={colors.muted}
              value={addBy}
              onChangeText={setAddBy}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={submitAddPlace}
                disabled={addingPlace}
              >
                <Text style={styles.modalSubmitBtnText}>
                  {addingPlace ? 'Adding...' : 'Add This Place'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAddPlaceModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  scrollContent: { paddingBottom: spacing.xl },
  header: { padding: spacing.md, gap: spacing.sm },
  title: { fontSize: 22, fontWeight: '700', color: colors.dark },
  subtext: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: spacing.xs },
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.leafPale,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  locationLabel: { fontSize: 10, textTransform: 'uppercase', color: colors.muted, letterSpacing: 0.5 },
  locationValue: { fontSize: 14, fontWeight: '500', color: colors.dark },
  locateBtn: {
    backgroundColor: colors.leaf,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
    minWidth: 90,
    alignItems: 'center',
  },
  locateBtnText: { color: colors.white, fontSize: 12, fontWeight: '500' },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 13,
    color: colors.dark,
  },
  searchBtn: { backgroundColor: colors.leaf, borderRadius: radius.pill, paddingHorizontal: spacing.md, justifyContent: 'center' },
  searchBtnText: { color: colors.white, fontSize: 13, fontWeight: '500' },
  radiusRow: { gap: 6, paddingVertical: 2 },
  radiusPill: {
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.1)',
    backgroundColor: colors.white,
  },
  radiusPillActive: { backgroundColor: colors.dark, borderColor: colors.dark },
  radiusPillText: { fontSize: 12, color: colors.muted, fontWeight: '500' },
  radiusPillTextActive: { color: colors.white },
  tierRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tierPill: { paddingVertical: 7, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1.5, borderColor: 'transparent' },
  tierPillText: { fontSize: 11, fontWeight: '500' },
  typeRow: { gap: 6, paddingVertical: 2 },
  typePill: {
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.1)',
    backgroundColor: colors.white,
  },
  typePillActive: { backgroundColor: colors.dark, borderColor: colors.dark },
  typePillText: { fontSize: 12, color: colors.muted, fontWeight: '500' },
  typePillTextActive: { color: colors.white },
  nameFilterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  nameFilterInput: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 13,
  },
  nameFilterClear: {
    backgroundColor: '#f5f5f5',
    borderRadius: radius.pill,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameFilterClearText: { fontSize: 13, color: colors.muted },
  chainNote: { fontSize: 10, color: colors.muted, fontStyle: 'italic', marginBottom: 4 },
  resultsHeader: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  resultsCount: { fontSize: 12, color: colors.muted },
  grid: { paddingHorizontal: spacing.md, gap: spacing.md },
  emptyBox: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.md },
  emptyIcon: { fontSize: 40, marginBottom: spacing.sm },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.dark, marginBottom: 6, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  cardHeader: { padding: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: '#f5f5f5', gap: 6 },
  cardHeaderTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.leafPale, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 16, fontWeight: '700', color: colors.dark },
  cardAddr: { fontSize: 11, color: colors.muted, marginTop: 2 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  cardDistance: { fontSize: 11, color: colors.muted },
  tierBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  dualRatings: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  ratingCol: { flex: 1, padding: spacing.sm },
  ratingColBorder: { borderRightWidth: 1, borderRightColor: '#f5f5f5' },
  ratingLabel: { fontSize: 10, textTransform: 'uppercase', color: colors.muted, fontWeight: '500', marginBottom: 4 },
  ratingNum: { fontSize: 14, color: colors.dark },
  ratingSub: { fontSize: 10, color: colors.muted, marginTop: 2 },
  ratingNone: { fontSize: 12, color: colors.muted, fontStyle: 'italic' },
  rateLink: { fontSize: 11, color: colors.leaf, marginTop: 4 },
  cardBody: { padding: spacing.sm },
  wtoBox: { backgroundColor: colors.leafXPale, borderRadius: 8, padding: 9 },
  wtoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  wtoLabel: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.leafLight, fontWeight: '600' },
  wtoReport: { fontSize: 10, color: colors.muted, textDecorationLine: 'underline' },
  wtoText: { fontSize: 11, color: colors.dark, lineHeight: 16 },
  noInfoText: { fontSize: 12, color: colors.muted, fontStyle: 'italic', padding: spacing.sm, backgroundColor: '#f9f9f9', borderRadius: 8 },
  cardFooter: { flexDirection: 'row', gap: 6, padding: spacing.sm, borderTopWidth: 1, borderTopColor: '#f5f5f5' },
  directionsBtn: { flex: 1, backgroundColor: colors.leaf, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  directionsBtnText: { color: colors.white, fontSize: 12, fontWeight: '500' },
  smIconBtn: { backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  smIconBtnActive: { backgroundColor: colors.leaf, borderColor: colors.leaf },
  smIconTextActive: { color: colors.white },

  viewTabRow: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: colors.white,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  viewTabBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  viewTabBtnActive: { backgroundColor: colors.leaf },
  viewTabBtnText: { fontSize: 13, fontWeight: '500', color: colors.muted },
  viewTabBtnTextActive: { color: colors.white },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.md },
  modalCard: { backgroundColor: colors.white, borderRadius: 20, padding: spacing.lg, maxHeight: '85%' },
  modalTitle: { fontSize: 19, fontWeight: '700', color: colors.dark },
  modalSub: { fontSize: 13, color: colors.muted, marginBottom: spacing.md },
  modalSecLabel: { fontSize: 12, fontWeight: '700', color: colors.dark, marginTop: spacing.md, marginBottom: spacing.xs },
  starRow: { flexDirection: 'row', gap: 6 },
  star: { fontSize: 28 },
  tierVoteBtn: { borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)', borderRadius: 10, padding: spacing.sm, marginBottom: spacing.xs },
  tierVoteBtnSelected: { borderColor: colors.leaf, backgroundColor: colors.leafXPale },
  tierVoteTitle: { fontSize: 13, fontWeight: '600', color: colors.dark },
  tierVoteDesc: { fontSize: 11, color: colors.muted, marginTop: 2 },
  modalTextarea: { borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)', borderRadius: 10, padding: spacing.sm, minHeight: 70, fontSize: 13, color: colors.dark, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  modalSubmitBtn: { flex: 1, backgroundColor: colors.leaf, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  modalSubmitBtnText: { color: colors.white, fontSize: 14, fontWeight: '500' },
  modalCancelBtn: { borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)', borderRadius: radius.pill, paddingVertical: 13, paddingHorizontal: spacing.md, alignItems: 'center' },
  modalCancelBtnText: { color: colors.muted, fontSize: 14 },

  titleRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flagsQueueBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  flagsQueueBtnText: { fontSize: 17 },
  flagsBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.danger,
    borderRadius: 100,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagsBadgeText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  flagReasonBtn: {
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: colors.white,
  },
  flagReasonBtnSelected: { borderColor: colors.danger, backgroundColor: '#fef2f2' },
  flagReasonBtnText: { fontSize: 13, color: colors.dark },
  flagReasonBtnTextSelected: { color: '#991b1b' },
  flagsEmptyText: { textAlign: 'center', color: colors.muted, fontSize: 13, paddingVertical: spacing.xl },
  flagsQueueItem: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    padding: spacing.sm,
    marginBottom: 10,
  },
  flagsQueueItemName: { fontSize: 13, fontWeight: '600', color: colors.dark },
  flagsQueueItemDate: { fontSize: 11, color: colors.muted, marginBottom: 6 },
  flagsQueueItemReason: { fontSize: 13, color: colors.dark, marginBottom: 4 },
  flagsQueueItemDetails: { fontSize: 12, color: '#2a2a2a', marginBottom: 8 },
  flagsQueueActions: { flexDirection: 'row', gap: 8 },
  flagsQueueActionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  flagsQueueActionBtnText: { fontSize: 12, color: colors.dark },
  flagsQueueActionBtnDanger: { borderColor: colors.danger },
  flagsQueueActionBtnDangerText: { fontSize: 12, color: colors.danger, fontWeight: '500' },

  addPlaceBtn: {
    backgroundColor: colors.leafPale,
    borderRadius: radius.pill,
    paddingVertical: 10,
    alignItems: 'center',
  },
  addPlaceBtnText: { color: colors.leaf, fontSize: 13, fontWeight: '600' },
  communityBadge: {
    backgroundColor: '#fff8e1',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  communityBadgeText: { fontSize: 10, fontWeight: '600', color: '#c8963e' },

  addPlaceScroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  addPlaceInput: {
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.dark,
    backgroundColor: colors.white,
  },
  addPlaceTextarea: { minHeight: 80, textAlignVertical: 'top' },
  addCatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addCatBtn: {
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.1)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
  },
  addCatBtnSelected: { backgroundColor: colors.leafPale, borderColor: colors.leafLight },
  addCatBtnText: { fontSize: 12, color: colors.dark, fontWeight: '500' },
  addCatBtnTextSelected: { color: colors.leaf },
});
