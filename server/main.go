package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"google.golang.org/protobuf/proto"
)

// StopInfo は1つのバス停情報を表す構造体
type StopInfo struct {
	Name     string  `json:"name"`
	Yomi     string  `json:"yomi"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Platform string  `json:"platform"`
}

// StopsData は stop_id → StopInfo のマップ
type StopsData map[string]StopInfo

// TripStop は1停車地点の時刻情報
type TripStop struct {
	Time   string `json:"time"`
	StopID string `json:"stop_id"`
}

// TripInfo は1便の情報
type TripInfo struct {
	Headsign  string     `json:"headsign"`
	ServiceID string     `json:"service_id"`
	OfficeID  string     `json:"office_id"`
	Via       string     `json:"via"`
	Stops     []TripStop `json:"stops"`
}

// TripRealtimeUpdate はtrip_idをキーにした遅延情報 (サーバー内部用)
type TripRealtimeUpdate struct {
	TripID     string           `json:"trip_id"`
	RouteID    string           `json:"route_id"`
	Headsign   string           `json:"headsign,omitempty"`
	VehicleID  string           `json:"vehicle_id,omitempty"`
	TripDelay  int64            `json:"trip_delay,omitempty"`  // 全体の遅延秒数
	StopDelays map[string]int64 `json:"stop_delays,omitempty"` // stop_id -> delay_seconds のマップ
}

// AddedTripUpdate は trip_id が空の ADDED 便に対する車両IDベースのリアルタイム予測情報
type AddedTripUpdate struct {
	RouteID        string
	VehicleID      string
	StopIDs        []string
	PredictedTimes map[string]string
}

type routePatternInfo struct {
	PatternKey string
	Headsign   string
	OfficeID   string
	Via        string
	StopIDs    []string
}

// TimetablesData は route_id → trip_id → TripInfo のマップ
type TimetablesData map[string]map[string]TripInfo

// ShapeData は1経路パターンの形状データ
type ShapeData struct {
	Coordinates [][]float64 `json:"coordinates"`
	StopIndices []int       `json:"stop_indices"`
}

// ShapesData はパターンキー → ShapeData のマップ
type ShapesData map[string]ShapeData

// CalendarEntry は1サービスの運行カレンダー情報
type CalendarEntry struct {
	Days  []string `json:"days"`
	Start string   `json:"start"`
	End   string   `json:"end"`
}

// CalendarData は service_id → CalendarEntry のマップ
type CalendarData map[string]CalendarEntry

// CalendarDateException はカレンダー例外日
type CalendarDateException struct {
	ServiceID     string `json:"service_id"`
	Date          string `json:"date"`
	ExceptionType string `json:"exception_type"`
}

// ExtraData は extra.json の構造
type ExtraData struct {
	Offices       map[string]string       `json:"offices"`
	CalendarDates []CalendarDateException `json:"calendar_dates"`
}

// RouteInfo は1路線の基本情報
type RouteInfo struct {
	ShortName string `json:"short_name"`
	Color     string `json:"color"`
}

// RoutesData は route_id → RouteInfo のマップ
type RoutesData map[string]RouteInfo

// TripDetailResponse はクライアントに返す便詳細情報
type TripDetailResponse struct {
	TripID     string           `json:"trip_id"`
	RouteID    string           `json:"route_id"`
	RouteName  string           `json:"route_name"`
	RouteColor string           `json:"route_color"`
	Trip       TripInfo         `json:"trip"`
	Stops      StopsData        `json:"stops"`
	Shape      *ShapeData       `json:"shape"`
	OfficeName string           `json:"office_name"`
	Delays     map[string]int64 `json:"delays,omitempty"`     // stop_id -> delay_seconds
	TripDelay  int64            `json:"trip_delay,omitempty"` // この便全体の遅延秒数
}

// StopTimetableResponse はバス停の時刻表情報
type StopTimetableResponse struct {
	StopID     string                         `json:"stop_id"`
	StopName   string                         `json:"stop_name"`
	Timetables map[string]map[string]TripInfo `json:"timetables"`       // route_id -> trip_id -> TripInfo
	Delays     map[string]map[string]int64    `json:"delays,omitempty"` // route_id -> trip_id -> delay_seconds
}

// BusPosition はバス位置情報
type BusPosition struct {
	TripID               string    `json:"trip_id"`
	RouteID              string    `json:"route_id"`
	RouteName            string    `json:"route_name"`
	Headsign             string    `json:"headsign"`
	Position             []float64 `json:"position"` // [lng, lat]
	SpeedKmh             float64   `json:"speed_kmh"`
	OccupancyStatus      string    `json:"occupancy_status,omitempty"`
	Color                string    `json:"color"`
	DelaySeconds         int64     `json:"delay_seconds,omitempty"`          // 遅延秒数
	NextStopID           string    `json:"next_stop_id,omitempty"`           // 次のバス停 ID
	NextStopName         string    `json:"next_stop_name,omitempty"`         // 次のバス停名
	ScheduledArrivalTime string    `json:"scheduled_arrival_time,omitempty"` // 計画到着時刻 (HH:MM:SS)
	EstimatedArrivalTime string    `json:"estimated_arrival_time,omitempty"` // 予想到着時刻 (HH:MM:SS)
	VehicleID            string    `json:"vehicle_id,omitempty"`
}

// グローバル変数でデータをキャッシュ
var (
	stopsCache      StopsData
	timetablesCache TimetablesData
	shapesCache     ShapesData
	calendarCache   CalendarData
	extraCache      ExtraData
	routesCache     RoutesData
	jstLocation     = loadJSTLocation()

	staticRouteUniqueHeadsign = make(map[string]string)
	staticRouteStopHeadsign   = make(map[string]map[string]string)
	staticRoutePatterns       = make(map[string][]routePatternInfo)

	vehicleCache = struct {
		mu        sync.Mutex
		fetchedAt time.Time
		buses     []BusPosition
		fetching  bool
		fetchDone chan struct{}
	}{}

	tripUpdateCache = struct {
		mu             sync.Mutex
		fetchedAt      time.Time
		updates        map[string]*TripRealtimeUpdate // trip_id -> TripRealtimeUpdate
		addedByVehicle map[string]*AddedTripUpdate    // vehicle_id -> AddedTripUpdate
		fetching       bool
		fetchDone      chan struct{}
	}{
		updates:        make(map[string]*TripRealtimeUpdate),
		addedByVehicle: make(map[string]*AddedTripUpdate),
	}
)

const (
	odptVehicleRealtimeURL    = "https://api.odpt.org/api/v4/gtfs/realtime/odpt_SendaiMunicipal_bus_realtime_information_vehicle"
	odptTripUpdateRealtimeURL = "https://api.odpt.org/api/v4/gtfs/realtime/odpt_SendaiMunicipal_bus_realtime_information_trip_update"
)

var realtimeCacheTTL = 5 * time.Second

var odptHTTPClient = &http.Client{Timeout: 15 * time.Second}

func loadEnv() {
	_ = godotenv.Load(".env")
	_ = godotenv.Load("server/.env")
	_ = godotenv.Load("../.env")
}

func getODPTAccessToken() string {
	token := strings.TrimSpace(os.Getenv("ODPT_ACCESS_TOKEN"))
	if token != "" {
		return token
	}
	return strings.TrimSpace(os.Getenv("ODPT_CONSUMER_KEY"))
}

func loadRealtimeCacheTTL() {
	realtimeCacheTTL = 5 * time.Second
	raw := strings.TrimSpace(os.Getenv("REALTIME_CACHE_TTL_SECONDS"))
	if raw == "" {
		return
	}
	sec, err := strconv.Atoi(raw)
	if err != nil {
		log.Printf("警告: REALTIME_CACHE_TTL_SECONDS が不正です (%q)。既定値5秒を使用します", raw)
		return
	}
	if sec < 0 {
		sec = 0
	}
	realtimeCacheTTL = time.Duration(sec) * time.Second
}

func routeMeta(routeID string) (string, string) {
	if r, ok := routesCache[routeID]; ok {
		color := r.Color
		if color == "" || color == "000000" {
			color = "A3D742"
		}
		if r.ShortName != "" {
			return r.ShortName, color
		}
		return routeID, color
	}
	return routeID, "A3D742"
}

func headsignByTrip(routeID, tripID string) string {
	if trips, ok := timetablesCache[routeID]; ok {
		if trip, ok := trips[tripID]; ok {
			return trip.Headsign
		}
	}
	return ""
}

func fetchVehiclePositionsFromODPT() ([]BusPosition, error) {
	token := getODPTAccessToken()
	if token == "" {
		return nil, fmt.Errorf("ODPT access token is missing")
	}

	u, err := url.Parse(odptVehicleRealtimeURL)
	if err != nil {
		return nil, err
	}

	q := u.Query()
	q.Set("acl:consumerKey", token)
	u.RawQuery = q.Encode()

	res, err := odptHTTPClient.Get(u.String())
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 1024))
		return nil, fmt.Errorf("odpt vehicle fetch failed: status=%d body=%s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}

	feed := &gtfs.FeedMessage{}
	if err := proto.Unmarshal(body, feed); err != nil {
		return nil, fmt.Errorf("failed to parse gtfs-rt vehicle payload: %w", err)
	}

	buses := make([]BusPosition, 0, len(feed.Entity))
	for _, entity := range feed.Entity {
		vehicle := entity.GetVehicle()
		if vehicle == nil {
			continue
		}

		pos := vehicle.GetPosition()
		if pos == nil {
			continue
		}

		trip := vehicle.GetTrip()
		routeID := ""
		tripID := ""
		if trip != nil {
			routeID = trip.GetRouteId()
			tripID = trip.GetTripId()
		}

		if tripID == "" {
			tripID = "rt_" + entity.GetId()
		}

		actualRouteID := routeID
		var actualTrip *TripInfo

		// まず申告された routeID で便を探す
		if routeTrips, ok := timetablesCache[routeID]; ok {
			if t, ok := routeTrips[tripID]; ok {
				actualTrip = &t
			}
		}

		// 💡 見つからない場合、全路線から本当の所属路線を探して自動補正
		if actualTrip == nil {
			for rid, routeTrips := range timetablesCache {
				if t, ok := routeTrips[tripID]; ok {
					actualRouteID = rid
					actualTrip = &t
					break
				}
			}
		}

		// 正しい路線IDから、正式な系統名（例: X910）とカラーを取得
		routeName, color := routeMeta(actualRouteID)

		// 正しい便データから、正式な行先を取得
		headsign := headsignByTrip(actualRouteID, tripID)
		if headsign == "" && actualTrip != nil {
			headsign = actualTrip.Headsign
		}

		delaySeconds := int64(0)
		nextStopID := vehicle.GetStopId()
		scheduledArrivalTime := ""
		estimatedArrivalTime := ""

		// TripUpdate が利用できない場合に備え、Vehicle の timestamp から簡易遅延推定
		if routeTrips, ok := timetablesCache[actualRouteID]; ok {
			if tripInfo, ok := routeTrips[tripID]; ok && nextStopID != "" {
				for _, st := range tripInfo.Stops {
					if st.StopID != nextStopID {
						continue
					}
					scheduledArrivalTime = st.Time
					scheduledSec := timeToSec(st.Time)
					ts := int64(vehicle.GetTimestamp())
					if ts > 0 {
						actual := time.Unix(ts, 0).In(jstLocation)
						actualSec := actual.Hour()*3600 + actual.Minute()*60 + actual.Second()
						delta := actualSec - scheduledSec
						if delta > 12*3600 {
							delta -= 24 * 3600
						} else if delta < -12*3600 {
							delta += 24 * 3600
						}
						delaySeconds = int64(delta)
						estimatedArrivalTime = secToTime(scheduledSec + delta)
					}
					break
				}
			}
		}

		// TripUpdate が利用できない場合に備え、Vehicle の timestamp から簡易遅延推定
		if routeTrips, ok := timetablesCache[routeID]; ok {
			if tripInfo, ok := routeTrips[tripID]; ok && nextStopID != "" {
				for _, st := range tripInfo.Stops {
					if st.StopID != nextStopID {
						continue
					}
					scheduledArrivalTime = st.Time
					scheduledSec := timeToSec(st.Time)
					ts := int64(vehicle.GetTimestamp())
					if ts > 0 {
						actual := time.Unix(ts, 0).In(jstLocation)
						actualSec := actual.Hour()*3600 + actual.Minute()*60 + actual.Second()
						delta := actualSec - scheduledSec
						if delta > 12*3600 {
							delta -= 24 * 3600
						} else if delta < -12*3600 {
							delta += 24 * 3600
						}
						delaySeconds = int64(delta)
						estimatedArrivalTime = secToTime(scheduledSec + delta)
					}
					break
				}
			}
		}

		vehicleID := ""
		if vehicle.GetVehicle() != nil {
			vehicleID = vehicle.GetVehicle().GetId()
		}
		nextStopName := ""
		if nextStopID != "" {
			if st, ok := stopsCache[nextStopID]; ok {
				nextStopName = st.Name
			}
		}
		occupancyStatus := vehicle.GetOccupancyStatus().String()
		if occupancyStatus == "" || occupancyStatus == "OCCUPANCY_STATUS_UNKNOWN" {
			occupancyStatus = "NO_DATA_AVAILABLE"
		}

		buses = append(buses, BusPosition{
			TripID:               tripID,
			RouteID:              actualRouteID, // 💡 actualRouteID に変更
			RouteName:            routeName,
			Headsign:             headsign, // 💡 補正後の headsign を使用
			Position:             []float64{float64(pos.GetLongitude()), float64(pos.GetLatitude())},
			SpeedKmh:             float64(pos.GetSpeed()) * 3.6,
			OccupancyStatus:      occupancyStatus,
			Color:                color,
			DelaySeconds:         delaySeconds,
			NextStopID:           nextStopID,
			NextStopName:         nextStopName,
			ScheduledArrivalTime: scheduledArrivalTime,
			EstimatedArrivalTime: estimatedArrivalTime,
			VehicleID:            vehicleID,
		})
	}

	return buses, nil
}

func getRealtimeBusPositions() ([]BusPosition, error) {
	for {
		now := time.Now()
		if realtimeCacheTTL <= 0 {
			return fetchVehiclePositionsFromODPT()
		}

		vehicleCache.mu.Lock()
		if now.Sub(vehicleCache.fetchedAt) <= realtimeCacheTTL && len(vehicleCache.buses) > 0 {
			cached := make([]BusPosition, len(vehicleCache.buses))
			copy(cached, vehicleCache.buses)
			vehicleCache.mu.Unlock()
			return cached, nil
		}

		if vehicleCache.fetching {
			waitCh := vehicleCache.fetchDone
			vehicleCache.mu.Unlock()
			<-waitCh
			continue
		}

		vehicleCache.fetching = true
		vehicleCache.fetchDone = make(chan struct{})
		vehicleCache.mu.Unlock()

		buses, err := fetchVehiclePositionsFromODPT()

		vehicleCache.mu.Lock()
		if err == nil {
			vehicleCache.fetchedAt = time.Now()
			vehicleCache.buses = make([]BusPosition, len(buses))
			copy(vehicleCache.buses, buses)
		}
		vehicleCache.fetching = false
		close(vehicleCache.fetchDone)
		vehicleCache.fetchDone = nil
		vehicleCache.mu.Unlock()

		if err != nil {
			return nil, err
		}
		return buses, nil
	}
}

func filterBusesByBounds(buses []BusPosition, minLat, maxLat, minLng, maxLng float64) []BusPosition {
	filtered := make([]BusPosition, 0, len(buses))
	for _, bus := range buses {
		if len(bus.Position) < 2 {
			continue
		}
		lng := bus.Position[0]
		lat := bus.Position[1]
		if lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng {
			filtered = append(filtered, bus)
		}
	}
	return filtered
}

func parseBounds(c *gin.Context) (float64, float64, float64, float64, bool, error) {
	values := []string{
		c.Query("minLat"),
		c.Query("maxLat"),
		c.Query("minLng"),
		c.Query("maxLng"),
	}
	provided := false
	for _, value := range values {
		if value != "" {
			provided = true
			break
		}
	}
	if !provided {
		return 0, 0, 0, 0, false, nil
	}

	parsed := make([]float64, len(values))
	for i, value := range values {
		if value == "" {
			return 0, 0, 0, 0, true, fmt.Errorf("all bounds parameters are required")
		}
		parsedValue, err := strconv.ParseFloat(value, 64)
		if err != nil || math.IsNaN(parsedValue) || math.IsInf(parsedValue, 0) {
			return 0, 0, 0, 0, true, fmt.Errorf("invalid bounds parameter")
		}
		parsed[i] = parsedValue
	}
	if parsed[0] > parsed[1] || parsed[2] > parsed[3] {
		return 0, 0, 0, 0, true, fmt.Errorf("invalid bounds range")
	}
	return parsed[0], parsed[1], parsed[2], parsed[3], true, nil
}

func loadJSTLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		return time.FixedZone("JST", 9*60*60)
	}
	return loc
}

func nowInJST() time.Time {
	return time.Now().In(jstLocation)
}

func loadStopsData() error {
	file, err := os.ReadFile("./data/stops.json")
	if err != nil {
		return err
	}
	return json.Unmarshal(file, &stopsCache)
}

func loadAllData() error {
	if err := loadStopsData(); err != nil {
		return err
	}

	file, err := os.ReadFile("./data/timetables.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &timetablesCache); err != nil {
		return err
	}

	file, err = os.ReadFile("./data/shapes.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &shapesCache); err != nil {
		return err
	}

	file, err = os.ReadFile("./data/calendar.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &calendarCache); err != nil {
		return err
	}

	file, err = os.ReadFile("./data/extra.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &extraCache); err != nil {
		return err
	}

	file, err = os.ReadFile("./data/routes.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &routesCache); err != nil {
		return err
	}
	buildRouteHeadsignIndexes()
	return nil
}

func buildRouteHeadsignIndexes() {
	uniqueHeadsign := make(map[string]string)
	stopHeadsign := make(map[string]map[string]string)
	patternsByRoute := make(map[string][]routePatternInfo)

	for routeID, trips := range timetablesCache {
		routeHS := make(map[string]struct{})
		stopHS := make(map[string]map[string]struct{})
		seenPatterns := make(map[string]struct{})

		for _, trip := range trips {
			if len(trip.Stops) >= 2 {
				stopIDs := make([]string, len(trip.Stops))
				for i, st := range trip.Stops {
					stopIDs[i] = st.StopID
				}
				pk := strings.Join(stopIDs, "|")
				if _, exists := seenPatterns[pk]; !exists {
					seenPatterns[pk] = struct{}{}
					patternsByRoute[routeID] = append(patternsByRoute[routeID], routePatternInfo{
						PatternKey: pk,
						Headsign:   trip.Headsign,
						OfficeID:   trip.OfficeID,
						Via:        trip.Via,
						StopIDs:    stopIDs,
					})
				}
			}

			if trip.Headsign == "" {
				continue
			}
			routeHS[trip.Headsign] = struct{}{}
			for _, st := range trip.Stops {
				if st.StopID == "" {
					continue
				}
				if stopHS[st.StopID] == nil {
					stopHS[st.StopID] = make(map[string]struct{})
				}
				stopHS[st.StopID][trip.Headsign] = struct{}{}
			}
		}

		if len(routeHS) == 1 {
			for hs := range routeHS {
				uniqueHeadsign[routeID] = hs
			}
		} else if len(routeHS) > 1 {
			byStop := make(map[string]string)
			for stopID, hsSet := range stopHS {
				if len(hsSet) == 1 {
					for hs := range hsSet {
						byStop[stopID] = hs
					}
				}
			}
			if len(byStop) > 0 {
				stopHeadsign[routeID] = byStop
			}
		}
	}

	staticRouteUniqueHeadsign = uniqueHeadsign
	staticRouteStopHeadsign = stopHeadsign
	staticRoutePatterns = patternsByRoute
}

func containsStopID(stopIDs []string, target string) bool {
	for _, sid := range stopIDs {
		if sid == target {
			return true
		}
	}
	return false
}

func isOrderedSubsequence(haystack, needle []string) bool {
	if len(needle) == 0 {
		return true
	}
	ni := 0
	for _, s := range haystack {
		if s == needle[ni] {
			ni++
			if ni == len(needle) {
				return true
			}
		}
	}
	return false
}

func inferPatternFromTimetables(routeID, nextStopID string, remainingStops []string) (routePatternInfo, bool) {
	cands := staticRoutePatterns[routeID]
	if len(cands) == 0 {
		return routePatternInfo{}, false
	}

	if len(cands) > 1 && nextStopID != "" {
		filtered := make([]routePatternInfo, 0, len(cands))
		for _, p := range cands {
			if containsStopID(p.StopIDs, nextStopID) {
				filtered = append(filtered, p)
			}
		}
		if len(filtered) > 0 {
			cands = filtered
		}
	}

	if len(cands) > 1 && len(remainingStops) > 0 {
		filtered := make([]routePatternInfo, 0, len(cands))
		for _, p := range cands {
			if isOrderedSubsequence(p.StopIDs, remainingStops) {
				filtered = append(filtered, p)
			}
		}
		if len(filtered) > 0 {
			cands = filtered
		}
	}

	if len(cands) == 1 {
		return cands[0], true
	}
	return routePatternInfo{}, false
}

func inferHeadsignFromTimetables(routeID, nextStopID string) string {
	if hs, ok := staticRouteUniqueHeadsign[routeID]; ok && hs != "" {
		return hs
	}
	if nextStopID != "" {
		if byStop, ok := staticRouteStopHeadsign[routeID]; ok {
			if hs, ok := byStop[nextStopID]; ok && hs != "" {
				return hs
			}
		}
	}
	return ""
}

func filterStopsByBounds(minLat, maxLat, minLng, maxLng float64) map[string]StopInfo {
	result := make(map[string]StopInfo)
	for stopID, stop := range stopsCache {
		if stop.Lat >= minLat && stop.Lat <= maxLat && stop.Lng >= minLng && stop.Lng <= maxLng {
			result[stopID] = stop
		}
	}
	return result
}

func timeToSec(t string) int {
	parts := strings.Split(t, ":")
	if len(parts) < 2 {
		return 0
	}
	hours, _ := strconv.Atoi(parts[0])
	minutes, _ := strconv.Atoi(parts[1])
	seconds := 0
	if len(parts) >= 3 {
		seconds, _ = strconv.Atoi(parts[2])
	}
	return hours*3600 + minutes*60 + seconds
}

func secToTime(sec int) string {
	sec = ((sec % 86400) + 86400) % 86400
	h := sec / 3600
	m := (sec % 3600) / 60
	s := sec % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

func isServiceRunningToday(serviceID string) bool {
	now := nowInJST()
	ymd := now.Format("20060102")

	for _, exception := range extraCache.CalendarDates {
		if exception.Date == ymd && exception.ServiceID == serviceID {
			return exception.ExceptionType == "1"
		}
	}

	cal, ok := calendarCache[serviceID]
	if !ok {
		return false
	}

	if ymd >= cal.Start && ymd <= cal.End {
		gtfsDayIdx := (int(now.Weekday()) + 6) % 7
		if gtfsDayIdx < len(cal.Days) {
			return cal.Days[gtfsDayIdx] == "1"
		}
	}

	startDate, _ := time.Parse("20060102", cal.Start)
	endDate, _ := time.Parse("20060102", cal.End)
	durationDays := endDate.Sub(startDate).Hours() / 24

	if durationDays >= 20 {
		gtfsDayIdx := (int(now.Weekday()) + 6) % 7
		if gtfsDayIdx < len(cal.Days) {
			return cal.Days[gtfsDayIdx] == "1"
		}
	}

	return false
}

func calculateBusPosition(trip TripInfo, nowSec int, patternKey string) []float64 {
	shape, ok := shapesCache[patternKey]
	if !ok || len(shape.Coordinates) == 0 || len(shape.StopIndices) == 0 {
		return nil
	}

	stops := trip.Stops
	coords := shape.Coordinates
	indices := shape.StopIndices

	for i := 0; i < len(stops)-1; i++ {
		s1 := timeToSec(stops[i].Time)
		s2 := timeToSec(stops[i+1].Time)

		if nowSec >= s1 && nowSec < s2 {
			timeRatio := float64(nowSec-s1) / float64(s2-s1)
			targetIndex := int(math.Floor(float64(indices[i]) + float64(indices[i+1]-indices[i])*timeRatio))
			if targetIndex >= len(coords) {
				targetIndex = len(coords) - 1
			}
			return coords[targetIndex]
		}
	}

	return nil
}

func calculateAllBusPositions() []BusPosition {
	now := nowInJST()
	nowSec := now.Hour()*3600 + now.Minute()*60 + now.Second()
	result := []BusPosition{}

	for routeID, trips := range timetablesCache {
		for tripID, trip := range trips {
			if !isServiceRunningToday(trip.ServiceID) {
				continue
			}
			stops := trip.Stops
			if len(stops) < 2 {
				continue
			}
			startSec := timeToSec(stops[0].Time)
			endSec := timeToSec(stops[len(stops)-1].Time)

			if nowSec >= startSec && nowSec <= endSec {
				stopIDs := make([]string, len(stops))
				for i, stop := range stops {
					stopIDs[i] = stop.StopID
				}
				patternKey := strings.Join(stopIDs, "|")
				pos := calculateBusPosition(trip, nowSec, patternKey)
				if pos != nil {
					routeInfo := routesCache[routeID]
					result = append(result, BusPosition{
						TripID:    tripID,
						RouteID:   routeID,
						RouteName: routeInfo.ShortName,
						Headsign:  trip.Headsign,
						Position:  pos,
						Color:     routeInfo.Color,
					})
				}
			}
		}
	}
	return result
}

// 💡 指定された秒数（0:00〜23:59の秒数）で運行しているバスをすべて逆算する関数
func calculateAllBusPositionsAt(nowSec int) []BusPosition {
	result := []BusPosition{}

	for routeID, trips := range timetablesCache {
		for tripID, trip := range trips {
			if !isServiceRunningToday(trip.ServiceID) {
				continue
			}
			stops := trip.Stops
			if len(stops) < 2 {
				continue
			}
			startSec := timeToSec(stops[0].Time)
			endSec := timeToSec(stops[len(stops)-1].Time)

			if nowSec >= startSec && nowSec <= endSec {
				stopIDs := make([]string, len(stops))
				for i, stop := range stops {
					stopIDs[i] = stop.StopID
				}
				patternKey := strings.Join(stopIDs, "|")
				pos := calculateBusPosition(trip, nowSec, patternKey)
				if pos != nil {
					routeInfo := routesCache[routeID]
					result = append(result, BusPosition{
						TripID:    tripID,
						RouteID:   routeID,
						RouteName: routeInfo.ShortName,
						Headsign:  trip.Headsign,
						Position:  pos,
						Color:     routeInfo.Color,
					})
				}
			}
		}
	}
	return result
}

// リアルタイム遅延情報（TripUpdate）を取得してマップを生成
func fetchTripUpdatesFromODPT() (map[string]*TripRealtimeUpdate, map[string]*AddedTripUpdate, error) {
	token := getODPTAccessToken()
	if token == "" {
		return make(map[string]*TripRealtimeUpdate), make(map[string]*AddedTripUpdate), fmt.Errorf("ODPT access token is missing")
	}

	u, err := url.Parse(odptTripUpdateRealtimeURL)
	if err != nil {
		return make(map[string]*TripRealtimeUpdate), make(map[string]*AddedTripUpdate), err
	}

	q := u.Query()
	q.Set("acl:consumerKey", token)
	u.RawQuery = q.Encode()

	res, err := odptHTTPClient.Get(u.String())
	if err != nil {
		return make(map[string]*TripRealtimeUpdate), make(map[string]*AddedTripUpdate), err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return make(map[string]*TripRealtimeUpdate), make(map[string]*AddedTripUpdate), fmt.Errorf("odpt trip_update fetch failed: status=%d", res.StatusCode)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return make(map[string]*TripRealtimeUpdate), make(map[string]*AddedTripUpdate), err
	}

	feed := &gtfs.FeedMessage{}
	if err := proto.Unmarshal(body, feed); err != nil {
		return make(map[string]*TripRealtimeUpdate), make(map[string]*AddedTripUpdate), fmt.Errorf("failed to parse payload: %w", err)
	}

	updates := make(map[string]*TripRealtimeUpdate)
	addedByVehicle := make(map[string]*AddedTripUpdate)
	for _, entity := range feed.Entity {
		tu := entity.GetTripUpdate()
		if tu == nil || tu.GetTrip() == nil {
			continue
		}

		vehicleID := ""
		if tu.GetVehicle() != nil {
			vehicleID = tu.GetVehicle().GetId()
		}

		tripID := tu.GetTrip().GetTripId()
		if tripID == "" {
			if vehicleID != "" {
				type seqStop struct {
					seq    uint32
					stopID string
					ts     int64
				}
				var list []seqStop
				for _, stu := range tu.GetStopTimeUpdate() {
					stopID := stu.GetStopId()
					if stopID == "" {
						continue
					}
					var ts int64
					if stu.Arrival != nil && stu.Arrival.Time != nil && *stu.Arrival.Time > 0 {
						ts = *stu.Arrival.Time
					} else if stu.Departure != nil && stu.Departure.Time != nil && *stu.Departure.Time > 0 {
						ts = *stu.Departure.Time
					}
					list = append(list, seqStop{
						seq:    stu.GetStopSequence(),
						stopID: stopID,
						ts:     ts,
					})
				}
				sort.SliceStable(list, func(i, j int) bool {
					return list[i].seq < list[j].seq
				})
				if len(list) > 0 {
					stopIDs := make([]string, 0, len(list))
					predTimes := make(map[string]string)
					for _, item := range list {
						stopIDs = append(stopIDs, item.stopID)
						if item.ts > 0 {
							predTimes[item.stopID] = time.Unix(item.ts, 0).In(jstLocation).Format("15:04:05")
						}
					}
					addedByVehicle[vehicleID] = &AddedTripUpdate{
						RouteID:        tu.GetTrip().GetRouteId(),
						VehicleID:      vehicleID,
						StopIDs:        stopIDs,
						PredictedTimes: predTimes,
					}
				}
			}
			continue
		}

		headsign := ""

		delayMap := make(map[string]int64)
		var lastSeq uint32
		hasLastSeq := false
		lastStopID := ""

		// 各バス停ごとの遅延を愚直に保存
		for _, stu := range tu.GetStopTimeUpdate() {
			stopID := stu.GetStopId()
			if stopID == "" {
				continue
			}

			seq := stu.GetStopSequence()
			if !hasLastSeq || seq >= lastSeq {
				hasLastSeq = true
				lastSeq = seq
				lastStopID = stopID
			}

			if stu.Arrival != nil && stu.Arrival.Delay != nil {
				delayMap[stopID] = int64(*stu.Arrival.Delay)
			} else if stu.Departure != nil && stu.Departure.Delay != nil {
				delayMap[stopID] = int64(*stu.Departure.Delay)
			}
		}

		if lastStopID != "" {
			if stop, ok := stopsCache[lastStopID]; ok {
				headsign = strings.TrimSpace(stop.Name)
			}
		}

		tripDelay := int64(0)
		if tu.Delay != nil {
			tripDelay = int64(*tu.Delay)
		}

		updates[tripID] = &TripRealtimeUpdate{
			TripID:     tripID,
			RouteID:    tu.GetTrip().GetRouteId(),
			Headsign:   headsign,
			VehicleID:  vehicleID,
			TripDelay:  tripDelay,
			StopDelays: delayMap,
		}
	}
	return updates, addedByVehicle, nil
}

func getRealtimeTripUpdatesAll() (map[string]*TripRealtimeUpdate, map[string]*AddedTripUpdate, error) {
	for {
		now := time.Now()
		if realtimeCacheTTL <= 0 {
			return fetchTripUpdatesFromODPT()
		}

		tripUpdateCache.mu.Lock()
		if now.Sub(tripUpdateCache.fetchedAt) <= realtimeCacheTTL && (len(tripUpdateCache.updates) > 0 || len(tripUpdateCache.addedByVehicle) > 0) {
			cached := make(map[string]*TripRealtimeUpdate, len(tripUpdateCache.updates))
			for k, v := range tripUpdateCache.updates {
				cached[k] = v
			}
			cachedAdded := make(map[string]*AddedTripUpdate, len(tripUpdateCache.addedByVehicle))
			for k, v := range tripUpdateCache.addedByVehicle {
				cachedAdded[k] = v
			}
			tripUpdateCache.mu.Unlock()
			return cached, cachedAdded, nil
		}

		if tripUpdateCache.fetching {
			waitCh := tripUpdateCache.fetchDone
			tripUpdateCache.mu.Unlock()
			<-waitCh
			continue
		}

		tripUpdateCache.fetching = true
		tripUpdateCache.fetchDone = make(chan struct{})
		tripUpdateCache.mu.Unlock()

		updates, addedByVehicle, err := fetchTripUpdatesFromODPT()

		tripUpdateCache.mu.Lock()
		if err == nil {
			tripUpdateCache.fetchedAt = time.Now()
			tripUpdateCache.updates = updates
			tripUpdateCache.addedByVehicle = addedByVehicle
		}
		tripUpdateCache.fetching = false
		close(tripUpdateCache.fetchDone)
		tripUpdateCache.fetchDone = nil
		tripUpdateCache.mu.Unlock()

		if err != nil {
			return make(map[string]*TripRealtimeUpdate), make(map[string]*AddedTripUpdate), err
		}
		return updates, addedByVehicle, nil
	}
}

func getRealtimeTripUpdates() (map[string]*TripRealtimeUpdate, error) {
	updates, _, err := getRealtimeTripUpdatesAll()
	return updates, err
}

func main() {
	loadEnv()
	loadRealtimeCacheTTL()

	if err := loadAllData(); err != nil {
		log.Fatalf("データの読み込みに失敗しました: %v", err)
	}

	r := gin.Default()
	r.Use(gzip.Gzip(gzip.DefaultCompression))
	r.Use(cors.Default())

	r.GET("/api/stops", func(c *gin.Context) {
		c.JSON(http.StatusOK, stopsCache)
	})

	r.GET("/api/stops/search", func(c *gin.Context) {
		minLat, maxLat, minLng, maxLng, _, err := parseBounds(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		filteredStops := filterStopsByBounds(minLat, maxLat, minLng, maxLng)
		c.JSON(http.StatusOK, gin.H{
			"count": len(filteredStops),
			"stops": filteredStops,
		})
	})

	r.GET("/api/buses", func(c *gin.Context) {
		minLat, maxLat, minLng, maxLng, boundsProvided, boundsErr := parseBounds(c)
		if boundsErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": boundsErr.Error()})
			return
		}

		// 💡 デバッグ用シミュレーション時刻（例: simTime=08:30:00）の判定
		simTimeQuery := strings.TrimSpace(c.Query("simTime"))
		var buses []BusPosition
		realtimeErrStr := ""

		if simTimeQuery != "" {
			// simTimeが指定された場合は、時刻表ベースで計算（遅延なし）
			simSec := timeToSec(simTimeQuery)
			buses = calculateAllBusPositionsAt(simSec)
		} else {
			// 通常時はODPTリアルタイムGPSを取得
			var err error
			buses, err = getRealtimeBusPositions()
			if err != nil {
				realtimeErrStr = err.Error()
				buses = calculateAllBusPositions()
			}
		}

		// timetables に存在しない ADDED 便などで headsign が空になる場合、
		// TripUpdate 側の trip_headsign を優先して補完する。
		var addedByVehicle map[string]*AddedTripUpdate
		if tripUpdates, addedUpdates, updateErr := getRealtimeTripUpdatesAll(); updateErr == nil {
			addedByVehicle = addedUpdates
			updateByVehicle := make(map[string]*TripRealtimeUpdate)
			routeHeadsignSet := make(map[string]map[string]struct{})
			for _, u := range tripUpdates {
				if u != nil && u.VehicleID != "" {
					updateByVehicle[u.VehicleID] = u
				}
				if u != nil && u.RouteID != "" && u.Headsign != "" {
					if routeHeadsignSet[u.RouteID] == nil {
						routeHeadsignSet[u.RouteID] = make(map[string]struct{})
					}
					routeHeadsignSet[u.RouteID][u.Headsign] = struct{}{}
				}
			}

			routeUniqueHeadsign := make(map[string]string)
			for rid, hsSet := range routeHeadsignSet {
				if len(hsSet) != 1 {
					continue
				}
				for hs := range hsSet {
					routeUniqueHeadsign[rid] = hs
				}
			}

			for i := range buses {
				if buses[i].Headsign != "" {
					continue
				}

				if u, ok := tripUpdates[buses[i].TripID]; ok && u != nil && u.Headsign != "" {
					buses[i].Headsign = u.Headsign
					continue
				}

				if buses[i].VehicleID != "" {
					if u, ok := updateByVehicle[buses[i].VehicleID]; ok && u != nil && u.Headsign != "" {
						buses[i].Headsign = u.Headsign
						continue
					}
				}

				if hs, ok := routeUniqueHeadsign[buses[i].RouteID]; ok && hs != "" {
					buses[i].Headsign = hs
				}
			}
		}

		// リアルタイム情報で行先が補完できなかった場合でも、時刻表マスタで一意に決まる行先を補完する
		for i := range buses {
			if buses[i].Headsign == "" {
				var remainingStops []string
				if addedByVehicle != nil && buses[i].VehicleID != "" {
					if addedTU, ok := addedByVehicle[buses[i].VehicleID]; ok && addedTU != nil {
						remainingStops = addedTU.StopIDs
					}
				}
				if pat, ok := inferPatternFromTimetables(buses[i].RouteID, buses[i].NextStopID, remainingStops); ok && pat.Headsign != "" {
					buses[i].Headsign = pat.Headsign
				} else if hs := inferHeadsignFromTimetables(buses[i].RouteID, buses[i].NextStopID); hs != "" {
					buses[i].Headsign = hs
				}
			}
			if buses[i].NextStopName == "" && buses[i].NextStopID != "" {
				if st, ok := stopsCache[buses[i].NextStopID]; ok {
					buses[i].NextStopName = st.Name
				}
			}
		}

		if boundsProvided {
			buses = filterBusesByBounds(buses, minLat, maxLat, minLng, maxLng)
		}

		resp := gin.H{
			"count":     len(buses),
			"buses":     buses,
			"timestamp": time.Now().Unix(),
		}
		if realtimeErrStr != "" {
			resp["realtime_error"] = realtimeErrStr
		}
		c.JSON(http.StatusOK, resp)
	})

	r.GET("/api/trips/:routeId/:tripId", func(c *gin.Context) {
		routeID := c.Param("routeId")
		tripID := c.Param("tripId")

		var trip TripInfo
		found := false

		// 1. まずリクエストされた routeID で便を探す
		if routeTrips, ok := timetablesCache[routeID]; ok {
			if t, ok := routeTrips[tripID]; ok {
				trip = t
				found = true
			}
		}

		// 2. 💡 見つからない場合、路線IDのズレを考慮して全路線から tripID を探す（自動救済）
		if !found {
			for rid, routeTrips := range timetablesCache {
				if t, ok := routeTrips[tripID]; ok {
					trip = t
					routeID = rid // 正しい routeID に自動補正
					found = true
					break
				}
			}
		}

		// 3. リアルタイム専用の rt_* 便は、路線・次のバス停・TripUpdate から経路パターンが1通りに絞れる場合のみ組み立てる
		if !found && strings.HasPrefix(tripID, "rt_") {
			nextStopID := ""
			vehicleID := strings.TrimPrefix(tripID, "rt_VE_")
			if vehicleID == tripID {
				vehicleID = ""
			}
			if rtBuses, busErr := getRealtimeBusPositions(); busErr == nil {
				for _, b := range rtBuses {
					if b.TripID == tripID || (vehicleID != "" && b.VehicleID == vehicleID) {
						if b.RouteID != "" {
							routeID = b.RouteID
						}
						nextStopID = b.NextStopID
						if b.VehicleID != "" {
							vehicleID = b.VehicleID
						}
						break
					}
				}
			}

			var remainingStops []string
			var predTimes map[string]string
			if _, addedByVehicle, tuErr := getRealtimeTripUpdatesAll(); tuErr == nil && vehicleID != "" {
				if addedTU, ok := addedByVehicle[vehicleID]; ok && addedTU != nil {
					if addedTU.RouteID != "" {
						routeID = addedTU.RouteID
					}
					remainingStops = addedTU.StopIDs
					predTimes = addedTU.PredictedTimes
				}
			}

			if pat, ok := inferPatternFromTimetables(routeID, nextStopID, remainingStops); ok {
				stops := make([]TripStop, len(pat.StopIDs))
				for i, sid := range pat.StopIDs {
					tStr := ""
					if predTimes != nil {
						tStr = predTimes[sid]
					}
					stops[i] = TripStop{
						StopID: sid,
						Time:   tStr,
					}
				}
				trip = TripInfo{
					OfficeID: pat.OfficeID,
					Headsign: pat.Headsign,
					Via:      pat.Via,
					Stops:    stops,
				}
				found = true
			}
		}

		// 4. それでも見つからない場合のみ 404 Not Found
		if !found {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		tripStops := make(StopsData)
		for _, ts := range trip.Stops {
			if stop, exists := stopsCache[ts.StopID]; exists {
				tripStops[ts.StopID] = stop
			}
		}

		stopIDs := make([]string, len(trip.Stops))
		for i, stop := range trip.Stops {
			stopIDs[i] = stop.StopID
		}
		patternKey := strings.Join(stopIDs, "|")
		shape, hasShape := shapesCache[patternKey]

		delays := make(map[string]int64)
		tripDelay := int64(0)

		// リアルタイムデータをそのまま渡す
		if tripUpdates, err := getRealtimeTripUpdates(); err == nil {
			if rtUpdate, exists := tripUpdates[tripID]; exists {
				tripDelay = rtUpdate.TripDelay
				delays = rtUpdate.StopDelays
			}
		}

		response := TripDetailResponse{
			TripID:     tripID,
			RouteID:    routeID,
			RouteName:  routesCache[routeID].ShortName,
			RouteColor: routesCache[routeID].Color,
			Trip:       trip,
			Stops:      tripStops,
			OfficeName: extraCache.Offices[trip.OfficeID],
			Delays:     delays,
			TripDelay:  tripDelay,
		}
		if hasShape {
			response.Shape = &shape
		}
		c.JSON(http.StatusOK, response)
	})

	r.GET("/api/stops/:stopId/timetable", func(c *gin.Context) {
		stopID := c.Param("stopId")
		stop, ok := stopsCache[stopID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}

		filteredTimetables := make(map[string]map[string]TripInfo)
		for routeID, trips := range timetablesCache {
			for tripID, trip := range trips {
				for _, ts := range trip.Stops {
					if ts.StopID == stopID {
						if filteredTimetables[routeID] == nil {
							filteredTimetables[routeID] = make(map[string]TripInfo)
						}
						filteredTimetables[routeID][tripID] = trip
						break
					}
				}
			}
		}

		// リアルタイムデータをそのまま渡す
		delays := make(map[string]map[string]int64)
		if tripUpdates, err := getRealtimeTripUpdates(); err == nil {
			for routeID, trips := range filteredTimetables {
				for tripID := range trips {
					if rtUpdate, exists := tripUpdates[tripID]; exists {
						// そのバス停固有の遅延があれば採用、なければ便全体の遅延を採用
						delay := int64(0)
						if d, hasDelay := rtUpdate.StopDelays[stopID]; hasDelay {
							delay = d
						} else if rtUpdate.TripDelay > 0 {
							delay = rtUpdate.TripDelay
						}

						if delay > 0 {
							if delays[routeID] == nil {
								delays[routeID] = make(map[string]int64)
							}
							delays[routeID][tripID] = delay
						}
					}
				}
			}
		}

		c.JSON(http.StatusOK, StopTimetableResponse{
			StopID:     stopID,
			StopName:   stop.Name,
			Timetables: filteredTimetables,
			Delays:     delays,
		})
	})

	r.GET("/api/calendar", func(c *gin.Context) { c.JSON(http.StatusOK, calendarCache) })
	r.GET("/api/routes", func(c *gin.Context) { c.JSON(http.StatusOK, routesCache) })
	r.GET("/api/extra", func(c *gin.Context) { c.JSON(http.StatusOK, extraCache) })

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	r.Run("0.0.0.0:" + port)
}
