import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import json
import asyncio
import aiohttp
import hashlib
import time
import sqlite3
import logging
import threading
import queue
import concurrent.futures
from collections import defaultdict, Counter
from datetime import datetime, timedelta
import pickle
import os
import statistics
import random
import requests
from typing import Dict, List, Optional, Tuple, Any, Set
import numpy as np
from dataclasses import dataclass, asdict
import validators
import re
from enum import Enum
from functools import wraps
import yaml

# Complex configuration management system
class ConfigManager:
    def __init__(self):
        self.config = self._load_config()
        self.cache_config = self.config.get('cache', {})
        self.api_config = self.config.get('api', {})
        self.validation_config = self.config.get('validation', {})
        self.analytics_config = self.config.get('analytics', {})
        
    def _load_config(self):
        default_config = {
            'cache': {
                'db_path': 'spotify_cache.db',
                'ttl_hours': 24,
                'max_entries': 10000,
                'cleanup_interval': 3600
            },
            'api': {
                'rate_limit_per_minute': 100,
                'max_retries': 5,
                'backoff_factor': 2,
                'concurrent_requests': 10,
                'timeout': 30
            },
            'validation': {
                'min_preview_duration': 10,
                'max_preview_duration': 60,
                'required_audio_features': ['danceability', 'energy', 'valence'],
                'min_track_popularity': 10
            },
            'analytics': {
                'enable_metrics': True,
                'metrics_file': 'spotify_metrics.json',
                'performance_tracking': True
            }
        }
        try:
            with open('spotify_config.yaml', 'r') as f:
                user_config = yaml.safe_load(f)
                default_config.update(user_config)
        except FileNotFoundError:
            pass
        return default_config

# Complex caching system with SQLite
class SpotifyCacheManager:
    def __init__(self, config_manager):
        self.config = config_manager.cache_config
        self.db_path = self.config['db_path']
        self.ttl_hours = self.config['ttl_hours']
        self._init_db()
        self._start_cleanup_thread()
        
    def _init_db(self):
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value BLOB,
                timestamp REAL,
                access_count INTEGER DEFAULT 0,
                last_accessed REAL
            )
        ''')
        self.conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_timestamp ON cache(timestamp)
        ''')
        self.conn.commit()
        self.lock = threading.Lock()
        
    def _start_cleanup_thread(self):
        def cleanup_worker():
            while True:
                time.sleep(self.config['cleanup_interval'])
                self._cleanup_expired()
        
        cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
        cleanup_thread.start()
        
    def _cleanup_expired(self):
        with self.lock:
            cutoff_time = time.time() - (self.ttl_hours * 3600)
            self.conn.execute('DELETE FROM cache WHERE timestamp < ?', (cutoff_time,))
            self.conn.commit()
            
    def get(self, key: str) -> Optional[Any]:
        with self.lock:
            cursor = self.conn.execute(
                'SELECT value FROM cache WHERE key = ? AND timestamp > ?',
                (key, time.time() - (self.ttl_hours * 3600))
            )
            row = cursor.fetchone()
            if row:
                self.conn.execute(
                    'UPDATE cache SET access_count = access_count + 1, last_accessed = ? WHERE key = ?',
                    (time.time(), key)
                )
                self.conn.commit()
                return pickle.loads(row[0])
            return None
            
    def set(self, key: str, value: Any):
        with self.lock:
            serialized = pickle.dumps(value)
            self.conn.execute(
                'INSERT OR REPLACE INTO cache (key, value, timestamp, last_accessed) VALUES (?, ?, ?, ?)',
                (key, serialized, time.time(), time.time())
            )
            self.conn.commit()

# Rate limiting system
class RateLimiter:
    def __init__(self, config_manager):
        self.config = config_manager.api_config
        self.requests_per_minute = self.config['rate_limit_per_minute']
        self.request_times = []
        self.lock = threading.Lock()
        
    def wait_if_needed(self):
        with self.lock:
            now = time.time()
            self.request_times = [t for t in self.request_times if now - t < 60]
            
            if len(self.request_times) >= self.requests_per_minute:
                sleep_time = 60 - (now - self.request_times[0])
                if sleep_time > 0:
                    time.sleep(sleep_time)
                    
            self.request_times.append(now)

# Complex data validation system
class SpotifyDataValidator:
    def __init__(self, config_manager):
        self.config = config_manager.validation_config
        self.validation_errors = []
        
    def validate_song_clip(self, song_clip_url: Optional[str], track_data: Dict) -> Tuple[bool, List[str]]:
        errors = []
        
        if not song_clip_url:
            errors.append(f"No preview URL for track: {track_data.get('name', 'Unknown')}")
            return False, errors
            
        # Validate URL format
        if not validators.url(song_clip_url):
            errors.append(f"Invalid preview URL format: {song_clip_url}")
            return False, errors
            
        # Check if URL is accessible
        try:
            response = requests.head(song_clip_url, timeout=10)
            if response.status_code != 200:
                errors.append(f"Preview URL not accessible (status {response.status_code}): {song_clip_url}")
                return False, errors
                
            # Validate content type
            content_type = response.headers.get('content-type', '')
            if 'audio' not in content_type:
                errors.append(f"Preview URL does not serve audio content: {content_type}")
                return False, errors
                
            # Validate content length if available
            content_length = response.headers.get('content-length')
            if content_length:
                duration_estimate = int(content_length) / 16000  # Rough estimate
                if duration_estimate < self.config['min_preview_duration']:
                    errors.append(f"Preview too short: estimated {duration_estimate}s")
                elif duration_estimate > self.config['max_preview_duration']:
                    errors.append(f"Preview too long: estimated {duration_estimate}s")
                    
        except requests.RequestException as e:
            errors.append(f"Error accessing preview URL: {str(e)}")
            return False, errors
            
        return len(errors) == 0, errors
        
    def validate_track_data(self, track_data: Dict) -> Tuple[bool, List[str]]:
        errors = []
        
        required_fields = ['id', 'name', 'artists', 'album', 'popularity']
        for field in required_fields:
            if field not in track_data or not track_data[field]:
                errors.append(f"Missing required field: {field}")
                
        # Validate popularity
        if track_data.get('popularity', 0) < self.config['min_track_popularity']:
            errors.append(f"Track popularity too low: {track_data.get('popularity', 0)}")
            
        # Validate artist data
        if isinstance(track_data.get('artists'), list):
            for artist in track_data['artists']:
                if not isinstance(artist, dict) or 'name' not in artist:
                    errors.append("Invalid artist data structure")
                    
        return len(errors) == 0, errors
        
    def validate_audio_features(self, audio_features: Dict) -> Tuple[bool, List[str]]:
        errors = []
        
        for feature in self.config['required_audio_features']:
            if feature not in audio_features:
                errors.append(f"Missing audio feature: {feature}")
                continue
                
            value = audio_features[feature]
            if not isinstance(value, (int, float)) or not (0 <= value <= 1):
                errors.append(f"Invalid {feature} value: {value}")
                
        return len(errors) == 0, errors

# Complex analytics and metrics system
class SpotifyAnalytics:
    def __init__(self, config_manager):
        self.config = config_manager.analytics_config
        self.metrics = defaultdict(int)
        self.performance_data = []
        self.genre_analysis = defaultdict(list)
        self.audio_feature_trends = defaultdict(list)
        self.recommendation_effectiveness = []
        
    def track_api_call(self, endpoint: str, duration: float, success: bool):
        if self.config['performance_tracking']:
            self.metrics[f'api_calls_{endpoint}'] += 1
            self.metrics[f'api_success_{endpoint}'] += 1 if success else 0
            self.performance_data.append({
                'endpoint': endpoint,
                'duration': duration,
                'success': success,
                'timestamp': time.time()
            })
            
    def analyze_audio_features(self, tracks_with_features: List[Dict]):
        feature_names = ['danceability', 'energy', 'valence', 'acousticness', 'instrumentalness']
        
        for track in tracks_with_features:
            features = track.get('audio_features', {})
            for feature in feature_names:
                if feature in features:
                    self.audio_feature_trends[feature].append(features[feature])
                    
    def calculate_playlist_similarity(self, playlist1_features: List[Dict], playlist2_features: List[Dict]) -> float:
        if not playlist1_features or not playlist2_features:
            return 0.0
            
        feature_names = ['danceability', 'energy', 'valence', 'acousticness']
        similarities = []
        
        for feature in feature_names:
            values1 = [t.get('audio_features', {}).get(feature, 0) for t in playlist1_features]
            values2 = [t.get('audio_features', {}).get(feature, 0) for t in playlist2_features]
            
            if values1 and values2:
                mean1, mean2 = statistics.mean(values1), statistics.mean(values2)
                similarity = 1 - abs(mean1 - mean2)
                similarities.append(similarity)
                
        return statistics.mean(similarities) if similarities else 0.0
        
    def generate_recommendations_score(self, user_preferences: Dict, recommended_tracks: List[Dict]) -> float:
        # Complex recommendation scoring algorithm
        preference_weights = {
            'energy': user_preferences.get('energy_preference', 0.5),
            'danceability': user_preferences.get('dance_preference', 0.5),
            'valence': user_preferences.get('mood_preference', 0.5)
        }
        
        scores = []
        for track in recommended_tracks:
            features = track.get('audio_features', {})
            track_score = 0
            
            for feature, weight in preference_weights.items():
                if feature in features:
                    feature_value = features[feature]
                    # Score based on how close the feature is to user preference
                    score = 1 - abs(feature_value - weight)
                    track_score += score
                    
            scores.append(track_score / len(preference_weights))
            
        return statistics.mean(scores) if scores else 0.0
        
    def export_analytics(self) -> Dict:
        return {
            'metrics': dict(self.metrics),
            'performance_summary': {
                'avg_response_time': statistics.mean([p['duration'] for p in self.performance_data]) if self.performance_data else 0,
                'success_rate': sum(1 for p in self.performance_data if p['success']) / len(self.performance_data) if self.performance_data else 0
            },
            'audio_feature_analysis': {
                feature: {
                    'mean': statistics.mean(values),
                    'median': statistics.median(values),
                    'std_dev': statistics.stdev(values) if len(values) > 1 else 0
                } for feature, values in self.audio_feature_trends.items() if values
            }
        }

# Complex recommendation engine
class SpotifyRecommendationEngine:
    def __init__(self, spotify_client, cache_manager, analytics):
        self.sp = spotify_client
        self.cache = cache_manager
        self.analytics = analytics
        self.user_profiles = {}
        self.genre_embeddings = {}
        
    def build_user_profile(self, user_playlists: List[Dict]) -> Dict:
        profile = {
            'favorite_genres': Counter(),
            'audio_preferences': defaultdict(list),
            'artist_preferences': Counter(),
            'temporal_patterns': defaultdict(int),
            'listening_diversity': 0.0
        }
        
        all_tracks = []
        for playlist in user_playlists:
            for track in playlist.get('tracks', []):
                all_tracks.append(track)
                
                # Analyze genres
                for artist in track.get('artists', []):
                    artist_data = self._get_artist_data(artist.get('id'))
                    if artist_data and 'genres' in artist_data:
                        for genre in artist_data['genres']:
                            profile['favorite_genres'][genre] += 1
                            
                # Analyze audio features
                audio_features = self._get_audio_features(track.get('id'))
                if audio_features:
                    for feature, value in audio_features.items():
                        if isinstance(value, (int, float)):
                            profile['audio_preferences'][feature].append(value)
                            
                # Track artist preferences
                for artist in track.get('artists', []):
                    profile['artist_preferences'][artist.get('name', '')] += 1
                    
        # Calculate listening diversity
        unique_artists = len(profile['artist_preferences'])
        total_tracks = len(all_tracks)
        profile['listening_diversity'] = unique_artists / total_tracks if total_tracks > 0 else 0
        
        # Average audio preferences
        for feature, values in profile['audio_preferences'].items():
            if values:
                profile['audio_preferences'][feature] = {
                    'mean': statistics.mean(values),
                    'std': statistics.stdev(values) if len(values) > 1 else 0
                }
                
        return profile
        
    def _get_artist_data(self, artist_id: str) -> Optional[Dict]:
        if not artist_id:
            return None
            
        cache_key = f"artist_{artist_id}"
        cached = self.cache.get(cache_key)
        if cached:
            return cached
            
        try:
            artist_data = self.sp.artist(artist_id)
            self.cache.set(cache_key, artist_data)
            return artist_data
        except Exception as e:
            logging.error(f"Error fetching artist data for {artist_id}: {e}")
            return None
            
    def _get_audio_features(self, track_id: str) -> Optional[Dict]:
        if not track_id:
            return None
            
        cache_key = f"audio_features_{track_id}"
        cached = self.cache.get(cache_key)
        if cached:
            return cached
            
        try:
            features = self.sp.audio_features([track_id])[0]
            if features:
                self.cache.set(cache_key, features)
            return features
        except Exception as e:
            logging.error(f"Error fetching audio features for {track_id}: {e}")
            return None
            
    def generate_recommendations(self, user_profile: Dict, num_recommendations: int = 50) -> List[Dict]:
        recommendations = []
        
        # Get seed data from user profile
        top_genres = [genre for genre, _ in user_profile['favorite_genres'].most_common(5)]
        top_artists = [artist for artist, _ in user_profile['artist_preferences'].most_common(5)]
        
        # Get recommendations from Spotify
        try:
            audio_prefs = user_profile['audio_preferences']
            target_features = {}
            
            for feature, data in audio_prefs.items():
                if isinstance(data, dict) and 'mean' in data:
                    target_features[f'target_{feature}'] = data['mean']
                    
            rec_response = self.sp.recommendations(
                seed_genres=top_genres[:2] if top_genres else ['pop'],
                seed_artists=[self._get_artist_id(artist) for artist in top_artists[:2] if self._get_artist_id(artist)],
                limit=num_recommendations,
                **target_features
            )
            
            for track in rec_response['tracks']:
                enhanced_track = self._enhance_track_data(track)
                recommendations.append(enhanced_track)
                
        except Exception as e:
            logging.error(f"Error generating recommendations: {e}")
            
        return recommendations
        
    def _get_artist_id(self, artist_name: str) -> Optional[str]:
        try:
            results = self.sp.search(q=f'artist:{artist_name}', type='artist', limit=1)
            if results['artists']['items']:
                return results['artists']['items'][0]['id']
        except Exception:
            pass
        return None
        
    def _enhance_track_data(self, track: Dict) -> Dict:
        enhanced = track.copy()
        
        # Add audio features
        audio_features = self._get_audio_features(track['id'])
        if audio_features:
            enhanced['audio_features'] = audio_features
            
        # Add artist genre information
        artist_genres = []
        for artist in track.get('artists', []):
            artist_data = self._get_artist_data(artist['id'])
            if artist_data and 'genres' in artist_data:
                artist_genres.extend(artist_data['genres'])
        enhanced['genres'] = list(set(artist_genres))
        
        return enhanced

# Main complex Spotify system
class ComplexSpotifySystem:
    def __init__(self):
        self.config_manager = ConfigManager()
        self.cache_manager = SpotifyCacheManager(self.config_manager)
        self.rate_limiter = RateLimiter(self.config_manager)
        self.validator = SpotifyDataValidator(self.config_manager)
        self.analytics = SpotifyAnalytics(self.config_manager)
        
        # Initialize Spotify client
        client_id = #FILL THIS IN
        client_secret = #FILL THIS IN
        
        client_credentials_manager = SpotifyClientCredentials(
            client_id=client_id, 
            client_secret=client_secret
        )
        self.sp = spotipy.Spotify(client_credentials_manager=client_credentials_manager)
        
        self.recommendation_engine = SpotifyRecommendationEngine(
            self.sp, self.cache_manager, self.analytics
        )
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('spotify_system.log'),
                logging.StreamHandler()
            ]
        )
        
        self.processed_playlists = []
        self.user_preferences = {}
        self.recommendation_history = []
        
    def process_playlist_with_validation(self, playlist_url: str) -> Dict:
        start_time = time.time()
        
        try:
            self.rate_limiter.wait_if_needed()
            
            playlist_id = playlist_url.split("/")[-1].split("?")[0]
            cache_key = f"playlist_{playlist_id}"
            
            # Check cache first
            cached_data = self.cache_manager.get(cache_key)
            if cached_data:
                logging.info(f"Retrieved playlist {playlist_id} from cache")
                return cached_data
                
            # Fetch playlist data
            results = self.sp.playlist(playlist_id)
            
            playlist_data = {
                'id': playlist_id,
                'cover_image': results['images'][0]['url'] if results['images'] else None,
                'name': results['name'],
                'description': results['description'],
                'owner': results['owner']['display_name'],
                'followers': results['followers']['total'],
                'tracks': [],
                'validation_errors': [],
                'analytics': {
                    'total_tracks': 0,
                    'valid_previews': 0,
                    'invalid_previews': 0,
                    'average_popularity': 0,
                    'genre_distribution': Counter(),
                    'audio_feature_averages': {}
                }
            }
            
            # Process tracks with complex validation and enhancement
            all_track_ids = []
            for track_item in results['tracks']['items']:
                if not track_item['track']:
                    continue
                    
                song = track_item['track']
                all_track_ids.append(song['id'])
                
                # Basic track data
                track_data = {
                    'id': song['id'],
                    'song_cover_image': song['album']['images'][0]['url'] if song['album']['images'] else None,
                    'song_title': song['name'],
                    'artist': ', '.join(artist['name'] for artist in song['artists']),
                    'artists': song['artists'],
                    'album': song['album']['name'],
                    'album_id': song['album']['id'],
                    'popularity': song['popularity'],
                    'explicit': song['explicit'],
                    'duration_ms': song['duration_ms'],
                    'song_clip': song.get('preview_url'),
                    'external_urls': song['external_urls'],
                    'impressions': '',
                    'discovery': '',
                    'notes': '',
                    'validation_status': 'pending',
                    'validation_errors': []
                }
                
                # Validate track data
                is_valid, validation_errors = self.validator.validate_track_data(song)
                track_data['validation_errors'].extend(validation_errors)
                
                # Validate song clip
                if track_data['song_clip']:
                    clip_valid, clip_errors = self.validator.validate_song_clip(
                        track_data['song_clip'], track_data
                    )
                    if clip_valid:
                        playlist_data['analytics']['valid_previews'] += 1
                        track_data['preview_validation'] = 'valid'
                    else:
                        playlist_data['analytics']['invalid_previews'] += 1
                        track_data['preview_validation'] = 'invalid'
                        track_data['validation_errors'].extend(clip_errors)
                else:
                    playlist_data['analytics']['invalid_previews'] += 1
                    track_data['preview_validation'] = 'missing'
                    track_data['validation_errors'].append('No preview URL available')
                
                track_data['validation_status'] = 'valid' if not track_data['validation_errors'] else 'invalid'
                playlist_data['tracks'].append(track_data)
                playlist_data['analytics']['total_tracks'] += 1
                
            # Batch fetch audio features for all tracks
            try:
                audio_features_batch = self.sp.audio_features(all_track_ids)
                feature_sums = defaultdict(float)
                feature_counts = defaultdict(int)
                
                for i, features in enumerate(audio_features_batch):
                    if features and i < len(playlist_data['tracks']):
                        playlist_data['tracks'][i]['audio_features'] = features
                        
                        # Validate audio features
                        features_valid, features_errors = self.validator.validate_audio_features(features)
                        if not features_valid:
                            playlist_data['tracks'][i]['validation_errors'].extend(features_errors)
                            
                        # Calculate averages
                        for feature, value in features.items():
                            if isinstance(value, (int, float)) and feature != 'duration_ms':
                                feature_sums[feature] += value
                                feature_counts[feature] += 1
                                
                # Calculate feature averages
                for feature, total in feature_sums.items():
                    if feature_counts[feature] > 0:
                        playlist_data['analytics']['audio_feature_averages'][feature] = total / feature_counts[feature]
                        
            except Exception as e:
                logging.error(f"Error fetching audio features: {e}")
                
            # Calculate analytics
            popularities = [track['popularity'] for track in playlist_data['tracks'] if track.get('popularity')]
            if popularities:
                playlist_data['analytics']['average_popularity'] = statistics.mean(popularities)
                
            # Genre analysis (requires additional API calls)
            self._analyze_playlist_genres(playlist_data)
            
            # Cache the processed data
            self.cache_manager.set(cache_key, playlist_data)
            
            # Track analytics
            self.analytics.track_api_call('playlist', time.time() - start_time, True)
            self.analytics.analyze_audio_features(playlist_data['tracks'])
            
            logging.info(f"Processed playlist {playlist_id} with {len(playlist_data['tracks'])} tracks")
            return playlist_data
            
        except Exception as e:
            self.analytics.track_api_call('playlist', time.time() - start_time, False)
            logging.error(f"Error processing playlist {playlist_url}: {e}")
            raise
            
    def _analyze_playlist_genres(self, playlist_data: Dict):
        """Analyze genres for playlist tracks by fetching artist data"""
        genre_counter = Counter()
        
        for track in playlist_data['tracks']:
            for artist in track.get('artists', []):
                try:
                    self.rate_limiter.wait_if_needed()
                    artist_data = self.recommendation_engine._get_artist_data(artist['id'])
                    if artist_data and 'genres' in artist_data:
                        for genre in artist_data['genres']:
                            genre_counter[genre] += 1
                except Exception as e:
                    logging.warning(f"Error fetching artist data for {artist.get('name', 'Unknown')}: {e}")
                    
        playlist_data['analytics']['genre_distribution'] = dict(genre_counter)
        
    def generate_comprehensive_recommendations(self, playlists: List[Dict]) -> Dict:
        """Generate recommendations based on analyzed playlists"""
        user_profile = self.recommendation_engine.build_user_profile(playlists)
        recommendations = self.recommendation_engine.generate_recommendations(user_profile, 50)
        
        # Score recommendations
        recommendation_score = self.analytics.generate_recommendations_score(
            user_profile.get('audio_preferences', {}), recommendations
        )
        
        return {
            'user_profile': user_profile,
            'recommendations': recommendations,
            'recommendation_score': recommendation_score,
            'generated_at': datetime.now().isoformat()
        }
        
    def export_comprehensive_data(self, output_format: str = 'json') -> str:
        """Export all processed data in various formats"""
        export_data = {
            'playlists': self.processed_playlists,
            'analytics': self.analytics.export_analytics(),
            'recommendations': self.recommendation_history,
            'system_metrics': {
                'cache_stats': self._get_cache_stats(),
                'validation_summary': self._get_validation_summary(),
                'processing_summary': self._get_processing_summary()
            },
            'export_timestamp': datetime.now().isoformat()
        }
        
        if output_format == 'json':
            filename = f'spotify_comprehensive_export_{int(time.time())}.json'
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=2, ensure_ascii=False, default=str)
        elif output_format == 'yaml':
            filename = f'spotify_comprehensive_export_{int(time.time())}.yaml'
            with open(filename, 'w', encoding='utf-8') as f:
                yaml.dump(export_data, f, default_flow_style=False, allow_unicode=True)
        
        return filename
        
    def _get_cache_stats(self) -> Dict:
        with self.cache_manager.lock:
            cursor = self.cache_manager.conn.execute(
                'SELECT COUNT(*), AVG(access_count), MAX(timestamp), MIN(timestamp) FROM cache'
            )
            count, avg_access, max_time, min_time = cursor.fetchone()
            
            return {
                'total_entries': count or 0,
                'average_access_count': avg_access or 0,
                'oldest_entry': datetime.fromtimestamp(min_time).isoformat() if min_time else None,
                'newest_entry': datetime.fromtimestamp(max_time).isoformat() if max_time else None
            }
            
    def _get_validation_summary(self) -> Dict:
        total_tracks = sum(len(p.get('tracks', [])) for p in self.processed_playlists)
        total_errors = sum(len(t.get('validation_errors', [])) for p in self.processed_playlists for t in p.get('tracks', []))
        valid_previews = sum(p.get('analytics', {}).get('valid_previews', 0) for p in self.processed_playlists)
        invalid_previews = sum(p.get('analytics', {}).get('invalid_previews', 0) for p in self.processed_playlists)
        
        return {
            'total_tracks_processed': total_tracks,
            'total_validation_errors': total_errors,
            'preview_validation_rate': valid_previews / (valid_previews + invalid_previews) if (valid_previews + invalid_previews) > 0 else 0,
            'error_rate': total_errors / total_tracks if total_tracks > 0 else 0
        }
        
    def _get_processing_summary(self) -> Dict:
        return {
            'playlists_processed': len(self.processed_playlists),
            'recommendations_generated': len(self.recommendation_history),
            'uptime_seconds': time.time() - getattr(self, 'start_time', time.time())
        }

# Main execution with complex workflow
def main():
    system = ComplexSpotifySystem()
    system.start_time = time.time()
    
    # Complex playlist URLs for testing
    playlist_urls = [
        "https://open.spotify.com/playlist/4X3GSB0TDlXdhY3BCvHZyu?si=d6002d907c924cac"
    ]
    
    logging.info("Starting complex Spotify analysis system...")
    
    # Process multiple playlists with full validation and analytics
    for i, playlist_url in enumerate(playlist_urls):
        try:
            logging.info(f"Processing playlist {i+1}/{len(playlist_urls)}: {playlist_url}")
            playlist_data = system.process_playlist_with_validation(playlist_url)
            system.processed_playlists.append(playlist_data)
            
            # Save individual playlist data
            filename = f'complex_playlist_data_{i+1}.json'
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(playlist_data, f, indent=2, ensure_ascii=False, default=str)
            logging.info(f'Complex playlist data saved to {filename}')
            
        except Exception as e:
            logging.error(f"Failed to process playlist {playlist_url}: {e}")
            continue
    
    # Generate comprehensive recommendations
    if system.processed_playlists:
        logging.info("Generating comprehensive recommendations...")
        recommendations_data = system.generate_comprehensive_recommendations(system.processed_playlists)
        system.recommendation_history.append(recommendations_data)
        
        # Save recommendations
        with open('spotify_recommendations.json', 'w', encoding='utf-8') as f:
            json.dump(recommendations_data, f, indent=2, ensure_ascii=False, default=str)
        logging.info("Recommendations saved to spotify_recommendations.json")
    
    # Export comprehensive analytics
    export_filename = system.export_comprehensive_data('json')
    logging.info(f"Comprehensive data exported to {export_filename}")
    
    # Save analytics report
    analytics_report = system.analytics.export_analytics()
    with open('spotify_analytics_report.json', 'w') as f:
        json.dump(analytics_report, f, indent=2, default=str)
    logging.info("Analytics report saved to spotify_analytics_report.json")
    
    logging.info("Complex Spotify analysis system completed successfully!")

if __name__ == "__main__":
    main()