package dev.chol.shopnow.order_service.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.web.client.ClientRegistrationIdProcessor;
import org.springframework.security.oauth2.client.web.client.OAuth2ClientHttpRequestInterceptor;
import org.springframework.web.client.support.RestClientHttpServiceGroupConfigurer;

import java.util.UUID;

@Configuration
public class HttpClientConfig {

    @Bean
    @ConditionalOnBean(OAuth2AuthorizedClientManager.class)
    RestClientHttpServiceGroupConfigurer oauth2HttpServiceGroupConfigurer(
            OAuth2AuthorizedClientManager authorizedClientManager,
            OAuth2AuthorizedClientService authorizedClientService) {
        OAuth2ClientHttpRequestInterceptor interceptor =
                new OAuth2ClientHttpRequestInterceptor(authorizedClientManager);
        interceptor.setAuthorizationFailureHandler(
                OAuth2ClientHttpRequestInterceptor.authorizationFailureHandler(authorizedClientService));

        return groups -> {
            groups.forEachClient((group, client) -> client.requestInterceptor(interceptor));
            groups.forEachProxyFactory((group, factory) ->
                    factory.httpRequestValuesProcessor(ClientRegistrationIdProcessor.DEFAULT_INSTANCE));
        };
    }

    @Bean
    RestClientHttpServiceGroupConfigurer productCorrelationIdHttpServiceGroupConfigurer() {
        return groups -> groups.filterByName("product-service")
                .forEachClient((group, client) -> client.requestInterceptor((request, body, execution) -> {
                    request.getHeaders().set("X-Correlation-Id", UUID.randomUUID().toString());
                    return execution.execute(request, body);
                }));
    }
}
