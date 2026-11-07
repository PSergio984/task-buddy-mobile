Pod::Spec.new do |s|
  s.name           = 'ExpoProximity'
  s.version        = '1.0.0'
  s.summary        = 'Proximity sensor events for Task Buddy phone-down sessions'
  s.description    = 'Emits covered/uncovered transitions from the device proximity sensor'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
