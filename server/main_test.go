package main

import (
	"testing"

	"github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

func TestParseTripUpdatesFeedCanceledAndSkipped(t *testing.T) {
	canceledRel := gtfs.TripDescriptor_CANCELED
	skippedRel := gtfs.TripUpdate_StopTimeUpdate_SKIPPED
	scheduledRel := gtfs.TripUpdate_StopTimeUpdate_SCHEDULED
	delay := int32(180)

	feed := &gtfs.FeedMessage{
		Entity: []*gtfs.FeedEntity{
			{
				Id: proto.String("tu-canceled"),
				TripUpdate: &gtfs.TripUpdate{
					Trip: &gtfs.TripDescriptor{
						TripId:               proto.String("trip-cancel-1"),
						RouteId:              proto.String("route-1"),
						ScheduleRelationship: &canceledRel,
					},
				},
			},
			{
				Id: proto.String("tu-skipped"),
				TripUpdate: &gtfs.TripUpdate{
					Trip: &gtfs.TripDescriptor{
						TripId:  proto.String("trip-skip-1"),
						RouteId: proto.String("route-2"),
					},
					StopTimeUpdate: []*gtfs.TripUpdate_StopTimeUpdate{
						{
							StopId:               proto.String("stop-a"),
							StopSequence:         proto.Uint32(1),
							ScheduleRelationship: &skippedRel,
							Arrival:              &gtfs.TripUpdate_StopTimeEvent{Delay: &delay},
						},
						{
							StopId:               proto.String("stop-b"),
							StopSequence:         proto.Uint32(2),
							ScheduleRelationship: &scheduledRel,
							Arrival:              &gtfs.TripUpdate_StopTimeEvent{Delay: &delay},
						},
					},
				},
			},
		},
	}

	updates, _ := parseTripUpdatesFeed(feed)

	canceledUpdate := updates["trip-cancel-1"]
	if canceledUpdate == nil || !canceledUpdate.Canceled {
		t.Fatalf("expected trip-cancel-1 to be marked canceled, got %+v", canceledUpdate)
	}
	if canceledUpdate.ScheduleRelationship != "CANCELED" {
		t.Fatalf("expected ScheduleRelationship CANCELED, got %q", canceledUpdate.ScheduleRelationship)
	}

	skipUpdate := updates["trip-skip-1"]
	if skipUpdate == nil || skipUpdate.Canceled {
		t.Fatalf("expected trip-skip-1 not canceled, got %+v", skipUpdate)
	}
	if !skipUpdate.SkippedStops["stop-a"] {
		t.Fatalf("expected stop-a to be marked skipped")
	}
	if skipUpdate.SkippedStops["stop-b"] {
		t.Fatalf("expected stop-b not to be marked skipped")
	}
	if _, hasDelay := skipUpdate.StopDelays["stop-a"]; hasDelay {
		t.Fatalf("expected skipped stop-a to omit delay")
	}
	if skipUpdate.StopDelays["stop-b"] != 180 {
		t.Fatalf("expected stop-b delay 180, got %d", skipUpdate.StopDelays["stop-b"])
	}
}

func TestParseAndMatchAlertsFeed(t *testing.T) {
	cause := gtfs.Alert_SPECIAL_EVENT
	effect := gtfs.Alert_DETOUR
	start := uint64(1000)
	end := uint64(2000)

	feed := &gtfs.FeedMessage{
		Entity: []*gtfs.FeedEntity{
			{
				Id: proto.String("alert-route"),
				Alert: &gtfs.Alert{
					Cause:  &cause,
					Effect: &effect,
					ActivePeriod: []*gtfs.TimeRange{
						{Start: &start, End: &end},
					},
					InformedEntity: []*gtfs.EntitySelector{
						{RouteId: proto.String("route-1")},
					},
					HeaderText: &gtfs.TranslatedString{
						Translation: []*gtfs.TranslatedString_Translation{
							{Language: proto.String("en"), Text: proto.String("Detour notice")},
							{Language: proto.String("ja"), Text: proto.String("駅伝に伴う迂回運行")},
						},
					},
					DescriptionText: &gtfs.TranslatedString{
						Translation: []*gtfs.TranslatedString_Translation{
							{Language: proto.String("ja"), Text: proto.String("一部バス停を通過します。")},
						},
					},
				},
			},
			{
				Id: proto.String("alert-expired"),
				Alert: &gtfs.Alert{
					ActivePeriod: []*gtfs.TimeRange{
						{Start: proto.Uint64(100), End: proto.Uint64(500)},
					},
					InformedEntity: []*gtfs.EntitySelector{
						{AgencyId: proto.String("SendaiMunicipal")},
					},
					HeaderText: &gtfs.TranslatedString{
						Translation: []*gtfs.TranslatedString_Translation{
							{Language: proto.String("ja"), Text: proto.String("終了したお知らせ")},
						},
					},
				},
			},
		},
	}

	parsed := parseAlertsFeed(feed)
	if len(parsed) != 2 {
		t.Fatalf("expected 2 parsed alerts, got %d", len(parsed))
	}
	if parsed[0].Alert.HeaderText != "駅伝に伴う迂回運行" {
		t.Fatalf("expected Japanese header priority, got %q", parsed[0].Alert.HeaderText)
	}

	matchedRoute1 := matchAlerts(parsed, 1500, map[string]bool{"route-1": true}, map[string]bool{}, map[string]bool{})
	if len(matchedRoute1) != 1 || matchedRoute1[0].ID != "alert-route" {
		t.Fatalf("expected alert-route to match route-1 at t=1500, got %+v", matchedRoute1)
	}

	matchedRoute2 := matchAlerts(parsed, 1500, map[string]bool{"route-2": true}, map[string]bool{}, map[string]bool{})
	if len(matchedRoute2) != 0 {
		t.Fatalf("expected no match for route-2, got %+v", matchedRoute2)
	}

	matchedAll := matchAlerts(parsed, 1500, nil, nil, nil)
	if len(matchedAll) != 1 || matchedAll[0].ID != "alert-route" {
		t.Fatalf("expected 1 active alert for wildcard match, got %+v", matchedAll)
	}
	if len(parsed[0].Alert.TargetRoutes) != 1 || parsed[0].Alert.TargetRoutes[0].RouteID != "route-1" {
		t.Fatalf("expected TargetRoutes to contain route-1, got %+v", parsed[0].Alert.TargetRoutes)
	}
	if !parsed[1].Alert.AgencyWide {
		t.Fatalf("expected AgencyId-only alert to set AgencyWide=true")
	}
}

func TestBuildDisruptedTripNotices(t *testing.T) {
	origTimetables := timetablesCache
	origRoutes := routesCache
	origStops := stopsCache
	defer func() {
		timetablesCache = origTimetables
		routesCache = origRoutes
		stopsCache = origStops
	}()

	routesCache = RoutesData{
		"r1": {ShortName: "S880", Color: "A3D742"},
	}
	stopsCache = StopsData{
		"s1": {Name: "実沢営業所", Lat: 38.31, Lng: 140.81},
		"s2": {Name: "仙台駅前", Lat: 38.26, Lng: 140.88},
	}
	timetablesCache = TimetablesData{
		"r1": {
			"t1": {
				Headsign: "仙台駅",
				Stops: []TripStop{
					{Time: "13:05:00", StopID: "s1"},
					{Time: "13:59:00", StopID: "s2"},
				},
			},
			"t2": {
				Headsign: "仙台駅",
				Stops: []TripStop{
					{Time: "12:30:00", StopID: "s1"},
					{Time: "13:20:00", StopID: "s2"},
				},
			},
		},
	}

	updates := map[string]*TripRealtimeUpdate{
		"t1": {
			TripID:   "t1",
			RouteID:  "r1",
			Canceled: true,
		},
		"t2": {
			TripID:       "t2",
			RouteID:      "r1",
			SkippedStops: map[string]bool{"s2": true},
		},
		"t_unknown": {
			TripID:   "t_unknown",
			RouteID:  "r1",
			Canceled: true,
		},
	}

	notices := buildDisruptedTripNotices(updates)
	if len(notices) != 2 {
		t.Fatalf("expected 2 notices sorted by StartTime, got %d (%+v)", len(notices), notices)
	}
	if notices[0].TripID != "t2" || len(notices[0].SkippedStops) != 1 || notices[0].SkippedStops[0].Name != "仙台駅前" {
		t.Fatalf("unexpected first notice: %+v", notices[0])
	}
	if notices[1].TripID != "t1" || !notices[1].Canceled || notices[1].RouteName != "S880" {
		t.Fatalf("unexpected second notice: %+v", notices[1])
	}
}
