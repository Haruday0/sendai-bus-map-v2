package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
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
	TripID     string     `json:"trip_id"`
	RouteID    string     `json:"route_id"`
	RouteName  string     `json:"route_name"`
	RouteColor string     `json:"route_color"`
	Trip       TripInfo   `json:"trip"`
	Stops      StopsData  `json:"stops"`
	Shape      *ShapeData `json:"shape"`
	OfficeName string     `json:"office_name"`
}

// StopTimetableResponse はバス停の時刻表情報
type StopTimetableResponse struct {
	StopID     string                         `json:"stop_id"`
	StopName   string                         `json:"stop_name"`
	Timetables map[string]map[string]TripInfo `json:"timetables"` // route_id -> trip_id -> TripInfo
}

// BusPosition はバス位置情報
type BusPosition struct {
	TripID    string    `json:"trip_id"`
	RouteID   string    `json:"route_id"`
	RouteName string    `json:"route_name"`
	Headsign  string    `json:"headsign"`
	Position  []float64 `json:"position"` // [lng, lat]
	Color     string    `json:"color"`
}

// グローバル変数でデータをキャッシュ
var (
	stopsCache      StopsData
	timetablesCache TimetablesData
	shapesCache     ShapesData
	calendarCache   CalendarData
	extraCache      ExtraData
	routesCache     RoutesData
)

// 起動時にバス停データを読み込む
func loadStopsData() error {
	file, err := os.ReadFile("../data/stops.json")
	if err != nil {
		return err
	}

	err = json.Unmarshal(file, &stopsCache)
	if err != nil {
		return err
	}

	log.Printf("バス停データを読み込みました: %d件", len(stopsCache))
	return nil
}

// 起動時に全データを読み込む
func loadAllData() error {
	// stops
	if err := loadStopsData(); err != nil {
		return err
	}

	// timetables
	file, err := os.ReadFile("../data/timetables.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &timetablesCache); err != nil {
		return err
	}
	log.Printf("時刻表データを読み込みました")

	// shapes
	file, err = os.ReadFile("../data/shapes.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &shapesCache); err != nil {
		return err
	}
	log.Printf("経路データを読み込みました: %d件", len(shapesCache))

	// calendar
	file, err = os.ReadFile("../data/calendar.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &calendarCache); err != nil {
		return err
	}
	log.Printf("カレンダーデータを読み込みました: %d件", len(calendarCache))

	// extra
	file, err = os.ReadFile("../data/extra.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &extraCache); err != nil {
		return err
	}
	log.Printf("拡張データを読み込みました")

	// routes
	file, err = os.ReadFile("../data/routes.json")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(file, &routesCache); err != nil {
		return err
	}
	log.Printf("路線データを読み込みました: %d件", len(routesCache))

	return nil
}

// 範囲内のバス停をフィルタリング
func filterStopsByBounds(minLat, maxLat, minLng, maxLng float64) map[string]StopInfo {
	result := make(map[string]StopInfo)

	for stopID, stop := range stopsCache {
		if stop.Lat >= minLat && stop.Lat <= maxLat &&
			stop.Lng >= minLng && stop.Lng <= maxLng {
			result[stopID] = stop
		}
	}

	return result
}

// 時刻文字列 "HH:MM:SS" を秒数に変換
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

// 現在のサービスが運行中かチェック
func isServiceRunningToday(serviceID string) bool {
	now := time.Now()
	ymd := now.Format("20060102")

	// 例外日チェック
	for _, exception := range extraCache.CalendarDates {
		if exception.Date == ymd && exception.ServiceID == serviceID {
			return exception.ExceptionType == "1"
		}
	}

	// カレンダーチェック
	cal, ok := calendarCache[serviceID]
	if !ok {
		return false
	}

	if ymd >= cal.Start && ymd <= cal.End {
		// GTFS形式: 月曜=0, 日曜=6
		gtfsDayIdx := (int(now.Weekday()) + 6) % 7
		if gtfsDayIdx < len(cal.Days) {
			return cal.Days[gtfsDayIdx] == "1"
		}
	}

	// 期限切れフォールバック
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

// バス位置を計算
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

// 現在運行中のバス位置を全て計算
func calculateAllBusPositions() []BusPosition {
	now := time.Now()
	nowSec := now.Hour()*3600 + now.Minute()*60 + now.Second()

	result := []BusPosition{}

	for routeID, trips := range timetablesCache {
		for tripID, trip := range trips {
			// サービス運行チェック
			if !isServiceRunningToday(trip.ServiceID) {
				continue
			}

			stops := trip.Stops
			if len(stops) < 2 {
				continue
			}

			// 運行時間内かチェック
			startSec := timeToSec(stops[0].Time)
			endSec := timeToSec(stops[len(stops)-1].Time)

			if nowSec >= startSec && nowSec <= endSec {
				// パターンキーを生成
				stopIDs := make([]string, len(stops))
				for i, stop := range stops {
					stopIDs[i] = stop.StopID
				}
				patternKey := strings.Join(stopIDs, "|")

				// 位置計算
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

// 範囲内の運行中バス位置のみを計算
func calculateBusPositionsInBounds(minLat, maxLat, minLng, maxLng float64) []BusPosition {
	now := time.Now()
	nowSec := now.Hour()*3600 + now.Minute()*60 + now.Second()

	result := []BusPosition{}

	for routeID, trips := range timetablesCache {
		for tripID, trip := range trips {
			// サービス運行チェック
			if !isServiceRunningToday(trip.ServiceID) {
				continue
			}

			stops := trip.Stops
			if len(stops) < 2 {
				continue
			}

			// 運行時間内かチェック
			startSec := timeToSec(stops[0].Time)
			endSec := timeToSec(stops[len(stops)-1].Time)

			if nowSec >= startSec && nowSec <= endSec {
				// パターンキーを生成
				stopIDs := make([]string, len(stops))
				for i, stop := range stops {
					stopIDs[i] = stop.StopID
				}
				patternKey := strings.Join(stopIDs, "|")

				// 位置計算
				pos := calculateBusPosition(trip, nowSec, patternKey)
				if len(pos) >= 2 {
					// 範囲内チェック
					lat := pos[1]
					lng := pos[0]
					if lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng {
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
	}

	return result
}

func main() {
	// 起動時に全データを読み込み
	if err := loadAllData(); err != nil {
		log.Fatalf("データの読み込みに失敗しました: %v", err)
	}

	r := gin.Default()

	// CORS設定：フロントエンドからのアクセスを許可
	r.Use(cors.Default())

	// 全バス停データを返すエンドポイント
	r.GET("/api/stops", func(c *gin.Context) {
		c.JSON(http.StatusOK, stopsCache)
	})

	// 範囲指定でバス停を検索するエンドポイント
	r.GET("/api/stops/search", func(c *gin.Context) {
		// クエリパラメータを取得
		minLatStr := c.Query("minLat")
		maxLatStr := c.Query("maxLat")
		minLngStr := c.Query("minLng")
		maxLngStr := c.Query("maxLng")

		// パラメータの検証
		if minLatStr == "" || maxLatStr == "" || minLngStr == "" || maxLngStr == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "minLat, maxLat, minLng, maxLng パラメータが必要です",
			})
			return
		}

		// 文字列を数値に変換
		minLat, err1 := strconv.ParseFloat(minLatStr, 64)
		maxLat, err2 := strconv.ParseFloat(maxLatStr, 64)
		minLng, err3 := strconv.ParseFloat(minLngStr, 64)
		maxLng, err4 := strconv.ParseFloat(maxLngStr, 64)

		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "座標パラメータは数値である必要があります",
			})
			return
		}

		// 範囲の妥当性チェック
		if minLat > maxLat || minLng > maxLng {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "範囲指定が不正です（min > max）",
			})
			return
		}

		// フィルタリング実行
		filteredStops := filterStopsByBounds(minLat, maxLat, minLng, maxLng)

		c.JSON(http.StatusOK, gin.H{
			"count": len(filteredStops),
			"stops": filteredStops,
		})
	})

	// 現在運行中のバス位置を返すエンドポイント（範囲指定オプション）
	r.GET("/api/buses", func(c *gin.Context) {
		// クエリパラメータを取得（オプション）
		minLatStr := c.Query("minLat")
		maxLatStr := c.Query("maxLat")
		minLngStr := c.Query("minLng")
		maxLngStr := c.Query("maxLng")

		var buses []BusPosition

		// 範囲指定がある場合はフィルタリング
		if minLatStr != "" && maxLatStr != "" && minLngStr != "" && maxLngStr != "" {
			minLat, err1 := strconv.ParseFloat(minLatStr, 64)
			maxLat, err2 := strconv.ParseFloat(maxLatStr, 64)
			minLng, err3 := strconv.ParseFloat(minLngStr, 64)
			maxLng, err4 := strconv.ParseFloat(maxLngStr, 64)

			if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "座標パラメータは数値である必要があります",
				})
				return
			}

			if minLat > maxLat || minLng > maxLng {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": "範囲指定が不正です（min > max）",
				})
				return
			}

			buses = calculateBusPositionsInBounds(minLat, maxLat, minLng, maxLng)

			// デバッグログ: 受け取った範囲と返却数を出力
			log.Printf("/api/buses bounds received: minLat=%f maxLat=%f minLng=%f maxLng=%f -> returned=%d\n", minLat, maxLat, minLng, maxLng, len(buses))
		} else {
			// 範囲指定なしの場合は全バスを返す
			buses = calculateAllBusPositions()
		}

		c.JSON(http.StatusOK, gin.H{
			"count":     len(buses),
			"buses":     buses,
			"timestamp": time.Now().Unix(),
		})
	})

	// 便詳細を返すエンドポイント（全停車バス停情報を含む）
	r.GET("/api/trips/:routeId/:tripId", func(c *gin.Context) {
		routeID := c.Param("routeId")
		tripID := c.Param("tripId")

		// 便データを取得
		routeTrips, ok := timetablesCache[routeID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "指定された路線が見つかりません",
			})
			return
		}

		trip, ok := routeTrips[tripID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "指定された便が見つかりません",
			})
			return
		}

		// この便が停車する全バス停情報を収集
		tripStops := make(StopsData)
		for _, ts := range trip.Stops {
			if stop, exists := stopsCache[ts.StopID]; exists {
				tripStops[ts.StopID] = stop
			}
		}

		// 経路形状データを取得
		stopIDs := make([]string, len(trip.Stops))
		for i, stop := range trip.Stops {
			stopIDs[i] = stop.StopID
		}
		patternKey := strings.Join(stopIDs, "|")
		shape := shapesCache[patternKey]

		// 路線情報を取得
		routeInfo := routesCache[routeID]
		officeName := extraCache.Offices[trip.OfficeID]

		response := TripDetailResponse{
			TripID:     tripID,
			RouteID:    routeID,
			RouteName:  routeInfo.ShortName,
			RouteColor: routeInfo.Color,
			Trip:       trip,
			Stops:      tripStops,
			Shape:      &shape,
			OfficeName: officeName,
		}

		c.JSON(http.StatusOK, response)
	})

	// バス停の時刻表を返すエンドポイント
	r.GET("/api/stops/:stopId/timetable", func(c *gin.Context) {
		stopID := c.Param("stopId")

		// バス停情報を取得
		stop, ok := stopsCache[stopID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "指定されたバス停が見つかりません",
			})
			return
		}

		// このバス停に停車する便をフィルタリング
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

		response := StopTimetableResponse{
			StopID:     stopID,
			StopName:   stop.Name,
			Timetables: filteredTimetables,
		}

		c.JSON(http.StatusOK, response)
	})

	// カレンダーデータを返すエンドポイント
	r.GET("/api/calendar", func(c *gin.Context) {
		c.JSON(http.StatusOK, calendarCache)
	})

	// 路線データを返すエンドポイント
	r.GET("/api/routes", func(c *gin.Context) {
		c.JSON(http.StatusOK, routesCache)
	})

	// 拡張データを返すエンドポイント
	r.GET("/api/extra", func(c *gin.Context) {
		c.JSON(http.StatusOK, extraCache)
	})

	log.Println("サーバーを起動します: http://localhost:8080")
	r.Run(":8080")
}
