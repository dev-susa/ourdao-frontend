import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { getContractUrl } from '@/lib/stellar'
import {
  Users,
  FileText,
  TrendingUp,
  Check,
  Globe,
  Zap,
  Lock,
} from 'lucide-react'
import { OrbitMark } from '@/components/OrbitMark'
import { MAIN_CONTENT_ID } from '@/lib/a11y'
import { LandingHeaderActions } from '@/components/landing/LandingHeaderActions'
import { LandingHeroCTA } from '@/components/landing/LandingHeroCTA'
import { LandingStats } from '@/components/landing/LandingStats'
import { LandingBottomCTA } from '@/components/landing/LandingBottomCTA'

// lucide-react dropped brand/logo icons (including Github) in v1 — inlined here instead.
function GithubMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.757-1.333-1.757-1.089-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.469-2.38 1.236-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

const features = [
  {
    name: 'Privacy-First Lending',
    description: 'Confidential loans with zero-knowledge proofs and encrypted voting to protect member privacy.',
    icon: Lock,
    gradient: 'from-purple-500 to-indigo-500',
  },
  {
    name: 'Automated P2P Loans',
    description: 'Smart contract-based lending with automatic approval, disbursement, and interest calculation.',
    icon: Zap,
    gradient: 'from-emerald-500 to-teal-500',
  },
  {
    name: 'Democratic Governance',
    description: 'Member-driven decision making with ENS-weighted voting and transparent proposal system.',
    icon: Users,
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    name: 'Document Storage',
    description: 'Decentralized IPFS storage for loan agreements and KYC documentation with encryption.',
    icon: FileText,
    gradient: 'from-orange-500 to-red-500',
  },
  {
    name: 'Yield Generation',
    description: 'Treasury optimization through staking with automatic yield distribution.',
    icon: TrendingUp,
    gradient: 'from-pink-500 to-rose-500',
  },
  {
    name: 'Real-time Updates',
    description: 'Live notifications and activity feeds keeping you informed of all DAO activities.',
    icon: Globe,
    gradient: 'from-violet-500 to-purple-500',
  },
]

const benefits = [
  'Transparent and Decentralized',
  'Privacy-Preserving Technology',
  'Automated Smart Contracts',
  'Community Governance',
  'Yield-Generating Treasury',
  'Real-time Notifications',
]

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-3">
              <OrbitMark className="h-11 w-11" />
              <Link href="/" className="text-xl font-bold text-foreground hover:text-muted-foreground transition-colors">
                OurDAO
              </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-8">
              <Link href="/loans" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Loans
              </Link>
              <Link href="/governance" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Governance
              </Link>
              <Link href="/treasury" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Treasury
              </Link>
              <Link href="/privacy" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Privacy
              </Link>
            </nav>

            <LandingHeaderActions />
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        {/* Hero Section */}
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-background dark:via-indigo-950/40 dark:to-background">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mb-8 flex justify-center">
                <OrbitMark className="h-24 w-24 sm:h-28 sm:w-28" />
              </div>

              <Badge variant="secondary" className="mb-6 px-4 py-2 text-sm font-medium">
                Next Generation DeFi Lending
              </Badge>

              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
                The Future of{' '}
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
                  Decentralized Lending
                </span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                Join the most advanced peer-to-peer lending DAO with privacy features,
                automated governance, and yield generation through staking.
              </p>
              
              <LandingHeroCTA />
            </div>
          </div>
          
          {/* Decorative elements */}
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-40 -right-32 h-80 w-80 rounded-full bg-gradient-to-r from-blue-400 to-purple-500 opacity-20 blur-3xl" />
            <div className="absolute -bottom-40 -left-32 h-80 w-80 rounded-full bg-gradient-to-r from-purple-400 to-pink-500 opacity-20 blur-3xl" />
          </div>
        </section>

        {/* Stats Section */}
        <LandingStats />

        {/* About Section */}
        <section className="py-24 bg-background">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <div>
                <Badge className="mb-6 px-3 py-1" variant="secondary">About OurDAO</Badge>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6">
                  Redefining Trustless, Private Lending
                </h2>
                <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                  OurDAO is a privacy-first, decentralized lending protocol built for communities.
                  We combine trustless smart contracts, encrypted document storage, zero-knowledge voting,
                  and real-time transparency to deliver a best-in-class experience for borrowers and lenders.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 mb-10">
                  {benefits.map((item) => (
                    <div key={item} className="flex items-center space-x-3">
                      <Check className="h-5 w-5 flex-shrink-0 text-green-500 dark:text-green-400" />
                      <span className="text-base text-foreground">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button asChild size="lg" className="w-full sm:w-auto px-6">
                    <Link href="/register">
                      Get Started
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="w-full sm:w-auto px-6">
                    <Link href="/governance">
                      Explore Governance
                    </Link>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-10 lg:mt-0">
                {features.slice(0, 4).map((f) => {
                  const Icon = f.icon
                  return (
                    <Card key={f.name} className="border-border hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${f.gradient} mb-4 flex items-center justify-center text-white`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <h4 className="text-lg font-semibold text-foreground mb-2">{f.name}</h4>
                        <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-24 bg-muted">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center mb-16">
              <Badge variant="secondary" className="mb-3">Our Platform</Badge>
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl mb-6">
                Advanced Features for Modern DeFi
              </h2>
              <p className="text-xl leading-8 text-muted-foreground mx-auto">
                Built with cutting-edge technology to provide the most comprehensive
                and secure lending experience in DeFi.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
              {features.map((feature) => {
                const Icon = feature.icon
                return (
                  <Card key={feature.name} className="border border-border hover:shadow-xl transition-all duration-300 h-full">
                    <CardHeader className="pb-2">
                      <div className={`w-14 h-14 rounded-xl bg-gradient-to-r ${feature.gradient} mb-6 flex items-center justify-center text-white shadow-sm`}>
                        <Icon className="w-7 h-7" />
                      </div>
                      <CardTitle className="text-xl font-bold mb-2 text-foreground">{feature.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="text-base text-muted-foreground leading-relaxed">
                        {feature.description}
                      </CardDescription>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="relative bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl mb-6">
                Ready to Join the Future of Lending?
              </h2>
              <p className="mx-auto text-xl leading-8 text-blue-100 mb-10">
                Connect your wallet and become part of a member-owned lending DAO on Stellar.
              </p>
              
              <LandingBottomCTA />
            </div>
          </div>
          
          {/* Background decoration */}
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
              <div className="h-[40rem] w-[40rem] rounded-full bg-gradient-to-r from-blue-400/20 to-purple-400/20 blur-3xl" />
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      {/* eslint-disable ourdao/no-raw-gray-classes -- Intentional: the footer is an always-dark
          band in both themes, so raw gray-900 bg with gray-400 text is kept — the
          semantic tokens flip with the theme and would wash out on it (e.g. light-mode
          text-muted-foreground is gray-500, below WCAG AA on the dark footer). */}
      <footer className="bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="py-16">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 lg:gap-12">
              <div className="col-span-1 md:col-span-2">
                <div className="flex items-center space-x-3 mb-6">
                  <OrbitMark className="h-11 w-11" />
                  <h3 className="text-xl font-bold text-white">OurDAO</h3>
                </div>
                <p className="text-base leading-relaxed text-gray-400 mb-6 max-w-md">
                  A member-owned peer-to-peer lending DAO on Stellar, with commit-reveal
                  private voting, automated governance, and yield generation.
                </p>
                <div className="flex space-x-4">
                  <a
                    href="https://github.com/ourdao"
                    target="_blank"
                    rel="noreferrer"
                    className="text-gray-400 hover:text-white transition-colors"
                    aria-label="OurDAO GitHub"
                  >
                    <GithubMark className="h-6 w-6" />
                  </a>
                </div>
              </div>
              
              <div>
                <h4 className="text-base font-semibold text-white mb-4">Product</h4>
                <ul className="space-y-3">
                  <li><Link href="/loans" className="text-gray-400 hover:text-white text-sm transition-colors">Loans</Link></li>
                  <li><Link href="/governance" className="text-gray-400 hover:text-white text-sm transition-colors">Governance</Link></li>
                  <li><Link href="/treasury" className="text-gray-400 hover:text-white text-sm transition-colors">Treasury</Link></li>
                  <li><Link href="/privacy" className="text-gray-400 hover:text-white text-sm transition-colors">Privacy</Link></li>
                </ul>
              </div>
              
              <div>
                <h4 className="text-base font-semibold text-white mb-4">Resources</h4>
                <ul className="space-y-3">
                  <li><span className="text-gray-400 text-sm">Documentation</span></li>
                  <li><a href="https://github.com/ourdao" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white text-sm transition-colors">GitHub</a></li>
                  <li><a href={getContractUrl() ?? undefined} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white text-sm transition-colors">View Contract</a></li>
                  <li><span className="text-gray-400 text-sm">Support</span></li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="border-t border-gray-800 py-8">
            <div className="flex flex-col md:flex-row justify-between items-center">
              <p className="text-sm text-gray-400">
                © {new Date().getFullYear()} OurDAO. All rights reserved.
              </p>
              <div className="flex space-x-6 mt-4 md:mt-0">
                <a href="/privacy" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">Privacy Policy</a>
                <a href="/terms" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">Terms of Service</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
      {/* eslint-enable ourdao/no-raw-gray-classes */}
    </div>
  )
}
