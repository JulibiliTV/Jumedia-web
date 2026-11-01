import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { RequireLogin, SiteLayout } from './components/Layout'
import { ConfirmHost, Empty, ToastHost } from './components/ui'
import { SessionProvider } from './lib/session'
import { AccountLayout, FanMedals, Favorites, Following, History, LiveFollowing, MyBangumi, Settings, WatchLater } from './pages/account/Account'
import { AdminLayout, ArchivesAdmin, Audit, BangumiAdmin, Banners, Dashboard, DataSourcesAdmin, LiveAdmin, Logs, Moderation, Regions, SiteSettings, Users } from './pages/admin/Admin'
import { Anime, AnimeIndex, BangumiPlay } from './pages/Anime'
import { Login, Register, TvLogin } from './pages/Auth'
import { Archives, Collections, CreatorHome, CreatorLayout, DataSources, LiveSettings, Upload } from './pages/creator/Creator'
import { ChannelPage } from './pages/Channel'
import { Dynamic, Popular, Ranking, Weekly } from './pages/Discover'
import Home from './pages/Home'
import { Live, LiveRoom } from './pages/Live'
import Search from './pages/Search'
import Space from './pages/Space'
import Video from './pages/Video'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<Home />} />
            <Route path="popular" element={<Popular />} />
            <Route path="popular/weekly" element={<Weekly />} />
            <Route path="ranking" element={<Ranking />} />
            <Route path="c/:kind" element={<ChannelPage />} />
            <Route path="video/:id" element={<Video />} />
            <Route path="anime" element={<Anime />} />
            <Route path="anime/index" element={<AnimeIndex />} />
            <Route path="bangumi/play/:id" element={<BangumiPlay />} />
            <Route path="live" element={<Live />} />
            <Route path="live/:id" element={<LiveRoom />} />
            <Route path="search" element={<Search />} />
            <Route path="space/:mid" element={<Space />} />
            <Route path="dynamic" element={<RequireLogin><Dynamic /></RequireLogin>} />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="tv-login" element={<TvLogin />} />
            <Route path="account" element={<RequireLogin><AccountLayout /></RequireLogin>}>
              <Route index element={<History />} />
              <Route path="history" element={<History />} />
              <Route path="watchlater" element={<WatchLater />} />
              <Route path="favorites" element={<Favorites />} />
              <Route path="bangumi" element={<MyBangumi />} />
              <Route path="following" element={<Following />} />
              <Route path="live" element={<LiveFollowing />} />
              <Route path="medals" element={<FanMedals />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="creator" element={<RequireLogin><CreatorLayout /></RequireLogin>}>
              <Route index element={<CreatorHome />} />
              <Route path="upload" element={<Upload />} />
              <Route path="upload/:aid" element={<Upload />} />
              <Route path="archives" element={<Archives />} />
              <Route path="collections" element={<Collections />} />
              <Route path="datasources" element={<DataSources />} />
              <Route path="live" element={<LiveSettings />} />
            </Route>
            <Route path="*" element={<div className="page"><Empty title="页面不存在" icon="alert-circle" /></div>} />
          </Route>
          <Route path="admin" element={<RequireLogin admin><AdminLayout /></RequireLogin>}>
            <Route index element={<Dashboard />} />
            <Route path="audit" element={<Audit />} />
            <Route path="archives" element={<ArchivesAdmin />} />
            <Route path="bangumi" element={<BangumiAdmin />} />
            <Route path="live" element={<LiveAdmin />} />
            <Route path="datasources" element={<DataSourcesAdmin />} />
            <Route path="users" element={<Users />} />
            <Route path="moderation" element={<Moderation />} />
            <Route path="regions" element={<Regions />} />
            <Route path="banners" element={<Banners />} />
            <Route path="settings" element={<SiteSettings />} />
            <Route path="logs" element={<Logs />} />
          </Route>
        </Routes>
        <ToastHost />
        <ConfirmHost />
      </BrowserRouter>
    </SessionProvider>
  )
}
