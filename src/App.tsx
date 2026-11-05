import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { RequireLogin, SiteLayout } from './components/Layout'
import { ConfirmHost, Empty, ToastHost } from './components/ui'
import { RouteContent } from './components/RouteContent'
import { SessionProvider } from './lib/session'
import Home from './pages/Home'

const AccountLayout = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.AccountLayout })))
const FanMedals = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.FanMedals })))
const Favorites = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.Favorites })))
const Following = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.Following })))
const History = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.History })))
const LiveFollowing = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.LiveFollowing })))
const MyBangumi = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.MyBangumi })))
const Settings = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.Settings })))
const WatchLater = lazy(() => import('./pages/account/Account').then((m) => ({ default: m.WatchLater })))
const BlacklistRedirect = lazy(() => import('./pages/account/Blacklist').then((m) => ({ default: m.BlacklistRedirect })))
const AdminLayout = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminLayout })))
const ArchivesAdmin = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.ArchivesAdmin })))
const Audit = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Audit })))
const BangumiAdmin = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.BangumiAdmin })))
const Banners = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Banners })))
const Dashboard = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Dashboard })))
const DataSourcesAdmin = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.DataSourcesAdmin })))
const LiveAdmin = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.LiveAdmin })))
const Logs = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Logs })))
const Moderation = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Moderation })))
const Regions = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Regions })))
const SiteSettings = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.SiteSettings })))
const Users = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Users })))
const Anime = lazy(() => import('./pages/Anime').then((m) => ({ default: m.Anime })))
const AnimeIndex = lazy(() => import('./pages/Anime').then((m) => ({ default: m.AnimeIndex })))
const BangumiPlay = lazy(() => import('./pages/Anime').then((m) => ({ default: m.BangumiPlay })))
const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })))
const Register = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Register })))
const TvLogin = lazy(() => import('./pages/Auth').then((m) => ({ default: m.TvLogin })))
const Archives = lazy(() => import('./pages/creator/Creator').then((m) => ({ default: m.Archives })))
const Collections = lazy(() => import('./pages/creator/Creator').then((m) => ({ default: m.Collections })))
const CreatorHome = lazy(() => import('./pages/creator/Creator').then((m) => ({ default: m.CreatorHome })))
const CreatorLayout = lazy(() => import('./pages/creator/Creator').then((m) => ({ default: m.CreatorLayout })))
const DataSources = lazy(() => import('./pages/creator/Creator').then((m) => ({ default: m.DataSources })))
const LiveSettings = lazy(() => import('./pages/creator/Creator').then((m) => ({ default: m.LiveSettings })))
const Upload = lazy(() => import('./pages/creator/Creator').then((m) => ({ default: m.Upload })))
const ChannelPage = lazy(() => import('./pages/Channel').then((m) => ({ default: m.ChannelPage })))
const Dynamic = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Dynamic })))
const Popular = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Popular })))
const Ranking = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Ranking })))
const Weekly = lazy(() => import('./pages/Discover').then((m) => ({ default: m.Weekly })))
const Live = lazy(() => import('./pages/Live').then((m) => ({ default: m.Live })))
const LiveRoom = lazy(() => import('./pages/Live').then((m) => ({ default: m.LiveRoom })))
const Search = lazy(() => import('./pages/Search'))
const Space = lazy(() => import('./pages/Space'))
const Video = lazy(() => import('./pages/Video'))

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.startsWith('/') ? import.meta.env.BASE_URL : '/'}>
        <RouteContent>
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
                <Route path="blacklist" element={<BlacklistRedirect />} />
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
        </RouteContent>
        <ToastHost />
        <ConfirmHost />
      </BrowserRouter>
    </SessionProvider>
  )
}
