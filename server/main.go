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
	VehicleID  string           `json:"vehicle_id,omitempty"`
	TripDelay  int64            `json:"trip_delay,omitempty"`  // 全体の遅延秒数
	StopDelays map[string]int64 `json:"stop_delays,omitempty"` // stop_id -> delay_seconds のマップ
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

	vehicleCache = struct {
		mu        sync.Mutex
		fetchedAt time.Time
		buses     []BusPosition
		fetching  bool
		fetchDone chan struct{}
	}{}

	tripUpdateCache = struct {
		mu        sync.Mutex
		fetchedAt time.Time
		updates   map[string]*TripRealtimeUpdate // trip_id -> TripRealtimeUpdate
		fetching  bool
		fetchDone chan struct{}
	}{
		updates: make(map[string]*TripRealtimeUpdate),
	}
)

const (
	odptVehicleRealtimeURL    = "https://api.odpt.org/api/v4/gtfs/realtime/odpt_SendaiMunicipal_bus_realtime_information_vehicle"
	odptTripUpdateRealtimeURL = "https://api.odpt.org/api/v4/gtfs/realtime/odpt_SendaiMunicipal_bus_realtime_information_trip_update"
)

var realtimeCacheTTL = 5 * time.Second

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
		if r.ShortName != "" {
			return r.ShortName, r.Color
		}
		return routeID, r.Color
	}
	return routeID, "00703c"
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

	res, err := http.Get(u.String())
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

		routeName, color := routeMeta(routeID)
		delaySeconds := int64(0)
		nextStopID := vehicle.GetStopId()
		scheduledArrivalTime := ""
		estimatedArrivalTime := ""

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
		occupancyStatus := vehicle.GetOccupancyStatus().String()
		if occupancyStatus == "" || occupancyStatus == "OCCUPANCY_STATUS_UNKNOWN" {
			occupancyStatus = "NO_DATA_AVAILABLE"
		}

		buses = append(buses, BusPosition{
			TripID:               tripID,
			RouteID:              routeID,
			RouteName:            routeName,
			Headsign:             headsignByTrip(routeID, tripID),
			Position:             []float64{float64(pos.GetLongitude()), float64(pos.GetLatitude())},
			SpeedKmh:             float64(pos.GetSpeed()) * 3.6,
			OccupancyStatus:      occupancyStatus,
			Color:                color,
			DelaySeconds:         delaySeconds,
			NextStopID:           nextStopID,
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
	return nil
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

// リアルタイム遅延情報（TripUpdate）を取得してマップを生成
func fetchTripUpdatesFromODPT() (map[string]*TripRealtimeUpdate, error) {
	token := getODPTAccessToken()
	if token == "" {
		return make(map[string]*TripRealtimeUpdate), fmt.Errorf("ODPT access token is missing")
	}

	u, err := url.Parse(odptTripUpdateRealtimeURL)
	if err != nil {
		return make(map[string]*TripRealtimeUpdate), err
	}

	q := u.Query()
	q.Set("acl:consumerKey", token)
	u.RawQuery = q.Encode()

	res, err := http.Get(u.String())
	if err != nil {
		return make(map[string]*TripRealtimeUpdate), err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return make(map[string]*TripRealtimeUpdate), fmt.Errorf("odpt trip_update fetch failed: status=%d", res.StatusCode)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return make(map[string]*TripRealtimeUpdate), err
	}

	feed := &gtfs.FeedMessage{}
	if err := proto.Unmarshal(body, feed); err != nil {
		return make(map[string]*TripRealtimeUpdate), fmt.Errorf("failed to parse payload: %w", err)
	}

	updates := make(map[string]*TripRealtimeUpdate)
	for _, entity := range feed.Entity {
		tu := entity.GetTripUpdate()
		if tu == nil || tu.GetTrip() == nil {
			continue
		}

		tripID := tu.GetTrip().GetTripId()
		if tripID == "" {
			continue
		}

		delayMap := make(map[string]int64)

		// 各バス停ごとの遅延を愚直に保存
		for _, stu := range tu.GetStopTimeUpdate() {
			stopID := stu.GetStopId()
			if stopID == "" {
				continue
			}
			if stu.Arrival != nil && stu.Arrival.Delay != nil {
				delayMap[stopID] = int64(*stu.Arrival.Delay)
			} else if stu.Departure != nil && stu.Departure.Delay != nil {
				delayMap[stopID] = int64(*stu.Departure.Delay)
			}
		}

		tripDelay := int64(0)
		if tu.Delay != nil {
			tripDelay = int64(*tu.Delay)
		}

		updates[tripID] = &TripRealtimeUpdate{
			TripID:     tripID,
			RouteID:    tu.GetTrip().GetRouteId(),
			TripDelay:  tripDelay,
			StopDelays: delayMap,
		}
	}
	return updates, nil
}

func getRealtimeTripUpdates() (map[string]*TripRealtimeUpdate, error) {
	for {
		now := time.Now()
		if realtimeCacheTTL <= 0 {
			return fetchTripUpdatesFromODPT()
		}

		tripUpdateCache.mu.Lock()
		if now.Sub(tripUpdateCache.fetchedAt) <= realtimeCacheTTL && len(tripUpdateCache.updates) > 0 {
			cached := make(map[string]*TripRealtimeUpdate)
			for k, v := range tripUpdateCache.updates {
				cached[k] = v
			}
			tripUpdateCache.mu.Unlock()
			return cached, nil
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

		updates, err := fetchTripUpdatesFromODPT()

		tripUpdateCache.mu.Lock()
		if err == nil {
			tripUpdateCache.fetchedAt = time.Now()
			tripUpdateCache.updates = updates
		}
		tripUpdateCache.fetching = false
		close(tripUpdateCache.fetchDone)
		tripUpdateCache.fetchDone = nil
		tripUpdateCache.mu.Unlock()

		if err != nil {
			return make(map[string]*TripRealtimeUpdate), err
		}
		return updates, nil
	}
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
		minLatStr := c.Query("minLat")
		maxLatStr := c.Query("maxLat")
		minLngStr := c.Query("minLng")
		maxLngStr := c.Query("maxLng")

		minLat, _ := strconv.ParseFloat(minLatStr, 64)
		maxLat, _ := strconv.ParseFloat(maxLatStr, 64)
		minLng, _ := strconv.ParseFloat(minLngStr, 64)
		maxLng, _ := strconv.ParseFloat(maxLngStr, 64)

		filteredStops := filterStopsByBounds(minLat, maxLat, minLng, maxLng)
		c.JSON(http.StatusOK, gin.H{
			"count": len(filteredStops),
			"stops": filteredStops,
		})
	})

	r.GET("/api/buses", func(c *gin.Context) {
		minLatStr := c.Query("minLat")
		maxLatStr := c.Query("maxLat")
		minLngStr := c.Query("minLng")
		maxLngStr := c.Query("maxLng")

		buses, err := getRealtimeBusPositions()
		realtimeErrStr := ""
		if err != nil {
			realtimeErrStr = err.Error()
			buses = calculateAllBusPositions()
		}

		if minLatStr != "" && maxLatStr != "" {
			minLat, _ := strconv.ParseFloat(minLatStr, 64)
			maxLat, _ := strconv.ParseFloat(maxLatStr, 64)
			minLng, _ := strconv.ParseFloat(minLngStr, 64)
			maxLng, _ := strconv.ParseFloat(maxLngStr, 64)
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

		routeTrips, ok := timetablesCache[routeID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		trip, ok := routeTrips[tripID]
		if !ok {
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
		shape := shapesCache[patternKey]

		delays := make(map[string]int64)
		tripDelay := int64(0)

		// リアルタイムデータをそのまま渡す
		if tripUpdates, err := getRealtimeTripUpdates(); err == nil {
			if rtUpdate, exists := tripUpdates[tripID]; exists {
				tripDelay = rtUpdate.TripDelay
				delays = rtUpdate.StopDelays
			}
		}

		c.JSON(http.StatusOK, TripDetailResponse{
			TripID:     tripID,
			RouteID:    routeID,
			RouteName:  routesCache[routeID].ShortName,
			RouteColor: routesCache[routeID].Color,
			Trip:       trip,
			Stops:      tripStops,
			Shape:      &shape,
			OfficeName: extraCache.Offices[trip.OfficeID],
			Delays:     delays,
			TripDelay:  tripDelay,
		})
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
